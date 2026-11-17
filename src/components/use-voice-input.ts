"use client";

import { useEffect, useRef, useState } from "react";

type RecognitionResult = {
  isFinal: boolean;
  [index: number]: { transcript: string };
};
type Recognizer = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type Session = {
  recognition?: Recognizer;
  timer?: ReturnType<typeof setTimeout>;
  receivedText: boolean;
  stopped: boolean;
};

const microphoneHelp =
  "Allow microphone access for this site in your browser. On Windows, also enable microphone access for desktop apps in Settings → Privacy & security → Microphone. In an embedded preview, open FORGE in Chrome.";
function voiceError(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
    case "NotAllowedError":
    case "SecurityError":
      return microphoneHelp;
    case "audio-capture":
    case "NotFoundError":
      return "No microphone is available. Connect a microphone and select it in your browser's site settings, then try again.";
    case "NotReadableError":
      return "The microphone is busy or unavailable. Close other apps using it and try again.";
    case "network":
      return "Your browser's speech service could not connect. Check your internet connection. If you are using an embedded preview, open FORGE in Chrome.";
    case "no-speech":
      return "No speech was detected. Check the selected microphone, then try speaking again.";
    case "language-not-supported":
      return "Your browser's speech service does not support this language. Open FORGE in Chrome with English speech enabled.";
    default:
      return `Voice input could not start (${code}). Try again or open FORGE in Chrome.`;
  }
}

export function useVoiceInput(
  onTranscript: (text: string) => void,
  onFinal?: (text: string) => void,
) {
  const [status, setStatus] = useState<
    "idle" | "starting" | "listening" | "stopping"
  >("idle");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const current = useRef<Session | null>(null);
  const transcriptHandler = useRef(onTranscript);
  const finalHandler = useRef(onFinal);
  useEffect(() => {
    transcriptHandler.current = onTranscript;
    finalHandler.current = onFinal;
  }, [onTranscript, onFinal]);

  function dispose(session: Session) {
    clearTimeout(session.timer);
    if (session.recognition) {
      session.recognition.onstart = null;
      session.recognition.onresult = null;
      session.recognition.onerror = null;
      session.recognition.onend = null;
      try {
        session.recognition.abort();
      } catch {
        /* Already ended. */
      }
    }
  }
  useEffect(
    () => () => {
      if (current.current) dispose(current.current);
      current.current = null;
    },
    [],
  );

  async function toggle(initialText: string) {
    const existing = current.current;
    if (existing) {
      if (existing.stopped) return;
      existing.stopped = true;
      clearTimeout(existing.timer);
      if (!existing.recognition) {
        current.current = null;
        setStatus("idle");
        setMessage("Voice input cancelled.");
        return;
      }
      setStatus("stopping");
      setMessage("Finishing transcription…");
      try {
        existing.recognition.stop();
      } catch {
        dispose(existing);
        current.current = null;
        setStatus("idle");
        setMessage("Voice input stopped.");
      }
      // Some browser engines fail to emit end after stop.
      if (current.current === existing)
        existing.timer = setTimeout(
          () => finish(existing, "Voice input stopped."),
          3000,
        );
      return;
    }
    const browser = window as typeof window & {
      SpeechRecognition?: new () => Recognizer;
      webkitSpeechRecognition?: new () => Recognizer;
    };
    const Recognition =
      browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    setFailed(false);
    if (!window.isSecureContext) {
      setFailed(true);
      setMessage(
        "Microphone access requires HTTPS or localhost. Open FORGE at http://127.0.0.1:3108 in Chrome.",
      );
      return;
    }
    if (!Recognition || !navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      setMessage(
        "Voice input is unavailable in this browser or preview. Open FORGE in Chrome and allow microphone access.",
      );
      return;
    }
    const session: Session = { receivedText: false, stopped: false };
    window.speechSynthesis?.cancel();
    current.current = session;
    setStatus("starting");
    setMessage("Allow microphone access when your browser asks…");
    session.timer = setTimeout(
      () =>
        finish(
          session,
          "Microphone access or the speech service did not respond. Allow microphone access, or open FORGE in Chrome and try again.",
          true,
        ),
      20000,
    );
    try {
      // Request permission explicitly and check the real device before speech startup.
      // Release these tracks immediately: the browser recognizer owns its own capture.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      if (current.current !== session) return;
      const recognition = new Recognition();
      session.recognition = recognition;
      recognition.lang = navigator.language.startsWith("en")
        ? navigator.language
        : "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (current.current !== session || session.stopped) return;
        clearTimeout(session.timer);
        setStatus("listening");
        setMessage("Listening. Speak your goal, then press Stop.");
        session.timer = setTimeout(
          () =>
            finish(
              session,
              "Voice input stopped after one minute. Review your request before building.",
            ),
          60000,
        );
      };
      recognition.onresult = (event) => {
        if (current.current !== session) return;
        const spoken = Array.from(event.results)
          .map((result) => result[0]?.transcript ?? "")
          .join(" ")
          .trim();
        if (!spoken) return;
        if (Array.from(event.results).every((result) => result.isFinal))
          finalHandler.current?.(spoken);
        session.receivedText = true;
        transcriptHandler.current(
          `${initialText.trim()} ${spoken}`.trim().slice(0, 4000),
        );
      };
      recognition.onerror = (event) => {
        if (current.current !== session) return;
        if (event.error === "aborted" && session.stopped)
          finish(session, "Voice input stopped.");
        else finish(session, voiceError(event.error), true);
      };
      recognition.onend = () =>
        finish(
          session,
          session.receivedText
            ? "Voice captured. Review your request, then build."
            : session.stopped
              ? "Voice input stopped."
              : voiceError("no-speech"),
          !session.receivedText && !session.stopped,
        );
      recognition.start();
    } catch (error) {
      finish(
        session,
        voiceError(error instanceof Error ? error.name : "unknown"),
        true,
      );
    }
  }
  function finish(session: Session, text: string, error = false) {
    if (current.current !== session) return;
    current.current = null;
    dispose(session);
    setStatus("idle");
    setMessage(text);
    setFailed(error);
  }
  function cancel() {
    if (!current.current) return;
    current.current.stopped = true;
    finish(current.current, "Voice input stopped.");
  }
  return { status, message, failed, toggle, cancel, active: status !== "idle" };
}
