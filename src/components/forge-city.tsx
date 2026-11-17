"use client";
import { useCallback } from "react";
import { CityCanvas } from "./city-canvas";
import { useForgeApplication } from "./forge-application";
export function ForgeCity() {
  const application = useForgeApplication();
  const city = application.snapshot?.city;
  const pause = useCallback(() => {
    if (city) application.control({ operation: "pause", paused: !city.paused });
  }, [application, city]);
  if (!city)
    return (
      <div className="city-loading">
        <span>FORGE</span>
        <p>Loading FORGE Twin…</p>
      </div>
    );
  return (
    <CityCanvas
      city={city}
      selected={application.selected}
      branch={application.branch}
      forecast={
        application.forecastVisible ? application.snapshot?.forecast : undefined
      }
      demo={application.demo}
      onSelect={application.select}
      onInspector={application.toggleInspector}
      onPause={pause}
      onClose={application.closePanels}
      onChat={() =>
        document
          .querySelector<HTMLTextAreaElement>(".forge-chat textarea")
          ?.focus()
      }
    />
  );
}
