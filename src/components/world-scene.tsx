"use client";
import { useState, type CSSProperties } from "react";
import { type WorldState, type rooms } from "@/forge/world";

const roomTiles: {
  id: (typeof rooms)[number];
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: string;
}[] = [
  {
    id: "bedroom",
    label: "BEDROOM",
    x: 118,
    y: 100,
    w: 244,
    h: 200,
    floor: "#d0ac95",
  },
  {
    id: "office",
    label: "OFFICE",
    x: 374,
    y: 100,
    w: 196,
    h: 200,
    floor: "#bbbf9b",
  },
  {
    id: "kitchen",
    label: "KITCHEN",
    x: 582,
    y: 100,
    w: 228,
    h: 200,
    floor: "#ddcba2",
  },
  {
    id: "living",
    label: "LIVING ROOM",
    x: 118,
    y: 314,
    w: 354,
    h: 212,
    floor: "#c9b794",
  },
  {
    id: "hallway",
    label: "ENTRANCE",
    x: 484,
    y: 314,
    w: 326,
    h: 212,
    floor: "#c2bdad",
  },
];
function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} className="pixel-plant">
      <rect x="6" y="19" width="24" height="22" fill="#b76c58" />
      <rect x="10" y="38" width="16" height="6" fill="#914e48" />
      <rect x="11" y="0" width="14" height="27" fill="#618467" />
      <rect x="0" y="8" width="18" height="12" fill="#7d9a67" />
      <rect x="23" y="5" width="12" height="16" fill="#92ad75" />
    </g>
  );
}
function Lamp({ x, y, on }: { x: number; y: number; on: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle
        cx="13"
        cy="16"
        r="55"
        fill="url(#world-lamp-glow)"
        opacity={on ? 0.9 : 0}
        className="room-glow"
      />
      <rect x="10" y="16" width="6" height="26" fill="#6b5547" />
      <rect x="3" y="39" width="20" height="5" fill="#6b5547" />
      <path d="M5 0H21L27 19H0Z" fill={on ? "#ffe8a4" : "#8e8b79"} />
      <rect
        x="3"
        y="19"
        width="20"
        height="4"
        fill={on ? "#eabe63" : "#696a5e"}
      />
    </g>
  );
}
export function WorldScene({
  world,
  running,
  motion,
  guardImpact,
}: {
  world: WorldState;
  running: boolean;
  motion?: {
    id: string;
    from: "home" | "away";
    to: "home" | "away";
    studying: boolean;
    fromStudying: boolean;
  };
  guardImpact?: string;
}) {
  const [inspected, setInspected] = useState(
    "Select a room to inspect its light.",
  );
  const night = world.timeOfDay === "night";
  const evening = world.timeOfDay === "evening";
  const studying =
    !!motion?.studying && world.presence === "home" && world.computerOn;
  const target =
    world.presence === "away" ? [825, 573] : studying ? [459, 244] : [626, 425];
  const start =
    motion?.from === "away"
      ? [825, 573]
      : motion?.fromStudying
        ? [459, 244]
        : [626, 425];
  const moving = !!motion && (motion.from !== motion.to || studying);
  return (
    <div
      className={`world-scene ${night ? "is-night" : evening ? "is-evening" : "is-day"} ${guardImpact ? "guard-focus" : ""}`}
      data-testid="world-scene"
    >
      <svg
        viewBox="45 35 860 605"
        role="img"
        aria-label={`Apartment simulation. ${world.presence}. Door ${world.doorLocked ? "locked" : "unlocked"}. ${world.temperature} degrees.`}
      >
        <defs>
          <radialGradient id="world-lamp-glow">
            <stop offset="0" stopColor="#ffe7a1" stopOpacity=".85" />
            <stop offset=".4" stopColor="#ffdb82" stopOpacity=".3" />
            <stop offset="1" stopColor="#ffd58a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="world-daylight" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff6bf" stopOpacity=".5" />
            <stop offset="1" stopColor="#fff6bf" stopOpacity="0" />
          </linearGradient>
          <pattern
            id="world-grass"
            width="28"
            height="28"
            patternUnits="userSpaceOnUse"
          >
            <rect
              width="28"
              height="28"
              fill={night ? "#27394e" : evening ? "#8a8870" : "#a3bb83"}
            />
            <path
              d="M4 8h4v4H4M20 21h4v4h-4"
              fill={night ? "#364c60" : evening ? "#99896d" : "#91aa78"}
              stroke={night ? "#334958" : evening ? "#9b9579" : "#b5c992"}
              strokeWidth="2"
            />
          </pattern>
          <pattern
            id="world-planks"
            width="48"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 0H48M0 32H48M24 0V32"
              fill="none"
              stroke="#514539"
              opacity=".09"
              strokeWidth="2"
            />
          </pattern>
        </defs>
        <rect width="930" height="650" fill="url(#world-grass)" />
        {!night && (
          <g
            className="outdoor-clouds"
            fill={evening ? "#edbd91" : "#eaf0d2"}
            opacity=".65"
          >
            <path d="M135 40h55v-9h35v9h23v15H135Z" />
            <path d="M575 25h40v-10h30v10h20v13h-90Z" />
          </g>
        )}
        <g className="garden-fence" fill={night ? "#566677" : "#f0dcb4"}>
          <rect x="20" y="76" width="64" height="6" />
          <rect x="844" y="76" width="65" height="6" />
          {[23, 45, 67, 850, 872, 894].map((x) => (
            <path key={x} d={`M${x} 64l5-5 5 5v35h-10Z`} />
          ))}
        </g>
        <path d="M575 537H718V650H575Z" fill={night ? "#727970" : "#d7cbb1"} />
        <path d="M595 570H698M595 615H698" stroke="#b6ad9a" strokeWidth="4" />
        {[30, 848].map((x) => (
          <g key={x} transform={`translate(${x} 145)`}>
            <rect x="23" y="8" width="16" height="145" fill="#775944" />
            <path
              d="M4 0H60V18H78V66H64V84H4V66H-12V18H4Z"
              fill={night ? "#294744" : "#537951"}
            />
            <path
              d="M7 9H52V23H65V55H7Z"
              fill={night ? "#35594e" : "#699663"}
            />
          </g>
        ))}
        {[55, 165, 270, 785, 850].map((x, i) => (
          <g key={x}>
            <rect
              x={x}
              y={570 + (i % 2) * 20}
              width="6"
              height="15"
              fill="#4f7056"
            />
            <rect
              x={x - 4}
              y={562 + (i % 2) * 20}
              width="14"
              height="10"
              fill={i % 2 ? "#e9bd8e" : "#cfa3a2"}
            />
            <rect
              x={x + 1}
              y={565 + (i % 2) * 20}
              width="4"
              height="4"
              fill="#fff0b4"
            />
          </g>
        ))}
        <rect
          x="104"
          y="96"
          width="725"
          height="454"
          rx="4"
          fill="#253c37"
          opacity=".25"
        />
        <rect x="96" y="87" width="736" height="472" fill="#6e6251" />
        <rect x="96" y="78" width="736" height="470" fill="#9b8267" />
        <rect x="102" y="78" width="724" height="8" fill="#f9e8c4" />
        <rect x="106" y="88" width="714" height="450" fill="#f0dfb8" />
        {roomTiles.map((room, i) => (
          <g
            key={room.id}
            className={`pixel-room ${world.lights[room.id] ? "lit" : "dim"}`}
            style={{ transitionDelay: `${i * 70}ms` }}
          >
            <rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              fill={room.floor}
            />
            <rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              fill="url(#world-planks)"
            />
            <rect
              x={room.x}
              y={room.y}
              width={room.w}
              height={room.h}
              fill="#213337"
              opacity={
                world.lights[room.id]
                  ? night
                    ? 0.03
                    : 0
                  : night
                    ? 0.72
                    : evening
                      ? 0.46
                      : 0.28
              }
              className="room-shade"
            />
            <g
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${room.id} light`}
              onClick={() =>
                setInspected(
                  `${room.label}: light ${world.lights[room.id] ? "on" : "off"}. Updated through the approved light.set primitive.`,
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setInspected(
                    `${room.label}: light ${world.lights[room.id] ? "on" : "off"}.`,
                  );
                }
              }}
            >
              <rect
                x={room.x + 8}
                y={room.y + 8}
                width={room.w - 16}
                height="23"
                fill="#fcf2d6"
                opacity=".75"
              />
              <text
                x={room.x + room.w / 2}
                y={room.y + 24}
                textAnchor="middle"
                fontSize="12"
                fill="#655d50"
                fontFamily="monospace"
                letterSpacing="2"
              >
                {room.label}
              </text>
            </g>
          </g>
        ))}
        <g
          className={
            world.lights.bedroom ? "furniture" : "furniture dim-object"
          }
        >
          <rect x="142" y="188" width="149" height="98" fill="#e7bd91" />
          <path
            d="M146 192h141v88H146Z"
            fill="none"
            stroke="#fbdeb3"
            strokeWidth="5"
          />
          <rect x="150" y="158" width="116" height="125" fill="#8b6357" />
          <rect x="156" y="164" width="104" height="109" fill="#f0dfbf" />
          <rect x="160" y="194" width="96" height="75" fill="#cb8f94" />
          <rect x="165" y="170" width="34" height="23" fill="#fff1d6" />
          <rect x="215" y="170" width="34" height="23" fill="#fff1d6" />
          <path
            d="M160 220H256M186 194V269M230 194V269"
            stroke="#e4adb0"
            strokeWidth="3"
          />
          <rect x="293" y="234" width="47" height="49" fill="#a5785c" />
          <Lamp x={300} y={186} on={world.lights.bedroom} />
          <Plant x={302} y={138} />
        </g>
        <g
          className={world.lights.office ? "furniture" : "furniture dim-object"}
        >
          <rect x="402" y="158" width="138" height="56" fill="#8b7153" />
          <rect x="414" y="210" width="9" height="26" fill="#735d47" />
          <rect x="522" y="210" width="9" height="26" fill="#735d47" />
          <rect x="442" y="156" width="60" height="41" fill="#3c5252" />
          <rect
            x="448"
            y="162"
            width="48"
            height="29"
            fill={world.computerOn ? "#92c4b9" : "#334747"}
            className="device-screen"
          />
          <path
            d="M458 176h22m-22 7h14"
            stroke={world.computerOn ? "#dff3d2" : "transparent"}
            strokeWidth="3"
          />
          <rect x="465" y="197" width="13" height="7" fill="#3c5252" />
          <rect x="442" y="210" width="62" height="8" fill="#ddcdb2" />
          <rect x="447" y="243" width="47" height="40" fill="#b28d70" />
          <rect x="451" y="248" width="39" height="24" fill="#688b83" />
          <path d="M470 272v12m-17 0h34" stroke="#626f60" strokeWidth="5" />
          <rect x="408" y="170" width="22" height="24" fill="#dfb387" />
          <path d="M415 176h9m-9 6h9" stroke="#957553" strokeWidth="2" />
          {world.computerOn && (
            <rect
              x="429"
              y="148"
              width="85"
              height="66"
              fill="#99e3c3"
              opacity=".12"
              className="monitor-aura"
            />
          )}
          <Plant x={400} y={242} />
          <Lamp x={518} y={244} on={world.lights.office} />
        </g>
        <g
          className={
            world.lights.kitchen ? "furniture" : "furniture dim-object"
          }
        >
          <rect x="604" y="151" width="186" height="55" fill="#788d77" />
          <rect x="604" y="148" width="186" height="17" fill="#eee3c7" />
          <rect x="615" y="173" width="48" height="27" fill="#aac1af" />
          <rect x="688" y="170" width="47" height="31" fill="#586c63" />
          <rect
            x="696"
            y="174"
            width="10"
            height="9"
            fill={world.appliancesOn ? "#e8b067" : "#3c4a46"}
          />
          <rect x="713" y="187" width="14" height="7" fill="#f8ead0" />
          <rect x="749" y="164" width="42" height="81" fill="#dce1c7" />
          <rect x="752" y="168" width="35" height="27" fill="#edf0d7" />
          <path
            d="M749 199h42m-34-21v10m0 26v13"
            stroke="#8c9a86"
            strokeWidth="3"
          />
          <rect
            x="717"
            y="158"
            width="5"
            height="5"
            fill={world.appliancesOn ? "#ffbf76" : "#5c6455"}
            className={world.appliancesOn ? "appliance-led" : ""}
          />
          <rect x="631" y="230" width="108" height="40" fill="#b48a65" />
          <rect x="620" y="239" width="12" height="25" fill="#d4b088" />
          <rect x="739" y="239" width="12" height="25" fill="#d4b088" />
          <Lamp x={599} y={239} on={world.lights.kitchen} />
        </g>
        <g
          className={world.lights.living ? "furniture" : "furniture dim-object"}
        >
          <rect x="173" y="389" width="205" height="108" fill="#e0c7a0" />
          <rect x="184" y="400" width="183" height="85" fill="#e8d1ab" />
          <rect x="154" y="380" width="90" height="73" fill="#668d81" />
          <rect x="148" y="385" width="17" height="76" fill="#507469" />
          <rect x="166" y="385" width="72" height="14" fill="#7caa96" />
          <rect x="171" y="402" width="28" height="39" fill="#8eb5a1" />
          <rect x="205" y="402" width="28" height="39" fill="#8eb5a1" />
          <rect x="281" y="417" width="68" height="46" fill="#a07b59" />
          <rect x="293" y="424" width="18" height="23" fill="#d8917a" />
          <rect x="320" y="428" width="15" height="13" fill="#f6e8ba" />
          <path
            d="M335 431h5v7h-5"
            fill="none"
            stroke="#f6e8ba"
            strokeWidth="3"
          />
          <rect x="390" y="380" width="63" height="53" fill="#3d5250" />
          <rect
            x="396"
            y="386"
            width="51"
            height="36"
            fill={world.tvOn ? "#91a3c5" : "#2c3d3b"}
            className="device-screen"
          />
          <rect x="402" y="429" width="40" height="8" fill="#a18365" />
          <Plant x={404} y={467} />
          <Lamp x={134} y={471} on={world.lights.living} />
        </g>
        <g>
          <rect x="508" y="366" width="58" height="88" fill="#8d7161" />
          <rect x="516" y="373" width="42" height="72" fill="#c4b69c" />
          <rect x="563" y="385" width="40" height="56" fill="#9e7758" />
          <path d="M568 400h30m-30 18h30" stroke="#e5c795" strokeWidth="4" />
          <path
            d="M574 392h8m7 0h8m-23 19h8m7 0h8"
            stroke="#5a6253"
            strokeWidth="5"
          />
          <rect x="653" y="351" width="6" height="62" fill="#937253" />
          <path
            d="M639 361h32m-24-6v18m17-18v18"
            stroke="#937253"
            strokeWidth="5"
          />
          <path d="M641 374h13v20h-13Z" fill="#749687" />
          <rect x="725" y="370" width="62" height="40" fill="#f3e8cb" />
          <rect x="731" y="377" width="50" height="25" fill="#d2dfc3" />
          <text
            x="756"
            y="394"
            textAnchor="middle"
            fontSize="15"
            fill="#4f655a"
            fontFamily="monospace"
          >
            {world.temperature}°
          </text>
          <Lamp x={767} y={456} on={world.lights.hallway} />
          <Plant x={701} y={471} />
        </g>
        {[
          { x: 281, y: 140, room: "bedroom" },
          { x: 513, y: 139, room: "office" },
          { x: 174, y: 347, room: "living" },
        ].map(({ x, y, room }) => (
          <g key={room} className="pixel-window">
            <rect x={x - 4} y={y - 4} width="65" height="36" fill="#8b735b" />
            <rect
              x={x}
              y={y}
              width="57"
              height="28"
              fill={night ? "#3e536f" : evening ? "#e6a478" : "#b1d4cb"}
            />
            <path
              d={`M${x + 28} ${y}v28M${x} ${y + 14}h57`}
              stroke="#f9e6be"
              strokeWidth="3"
            />
            {world.lights[room as keyof typeof world.lights] && night && (
              <rect
                x={x - 6}
                y={y - 6}
                width="69"
                height="40"
                fill="#ffe5a4"
                opacity=".22"
              />
            )}
            {!night && (
              <path
                d={`M${x} ${y + 30}l75 0 25 53h-86Z`}
                fill="url(#world-daylight)"
              />
            )}
          </g>
        ))}
        <rect
          x="603"
          y="516"
          width="76"
          height="33"
          fill={world.doorLocked ? "#9c7761" : "#b18c73"}
        />
        <path d="M611 527H671M641 518V547" stroke="#725945" strokeWidth="3" />
        <rect
          x="631"
          y="526"
          width="17"
          height="12"
          fill={world.doorLocked ? "#ffe0a1" : "#8cab86"}
        />
        <path
          d={world.doorLocked ? "M635 526V521H644V526" : "M635 524V518H644V522"}
          fill="none"
          stroke="#ffe0a1"
          strokeWidth="3"
        />
        <text
          x="641"
          y="568"
          textAnchor="middle"
          fill={night ? "#f6dba2" : "#534f3c"}
          fontFamily="monospace"
          fontSize="11"
          letterSpacing="1"
        >
          {world.doorLocked ? "LOCKED" : "UNLOCKED"}
        </text>
        <g
          key={world.doorLocked ? "locked" : "unlocked"}
          className="door-lock-stamp"
        >
          <rect
            x="680"
            y="517"
            width="28"
            height="27"
            fill={world.doorLocked ? "#6b9167" : "#d1a16c"}
          />
          <path
            d={world.doorLocked ? "M687 530l5 5 10-12" : "M687 529h15"}
            fill="none"
            stroke="#f7edc9"
            strokeWidth="3"
          />
        </g>
        <g
          key={motion?.id ?? "idle"}
          className={`world-avatar ${moving ? "is-moving" : ""} ${running ? "is-running" : ""} ${studying ? "is-studying" : ""}`}
          transform={`translate(${target[0]} ${target[1]})`}
          data-testid="world-avatar"
          data-state={
            studying ? "studying" : world.presence === "away" ? "away" : "idle"
          }
          data-motion={
            moving
              ? motion?.from === "away"
                ? "arriving"
                : motion?.to === "away"
                  ? "leaving"
                  : "studying"
              : "idle"
          }
          aria-label={`Mika is ${world.presence}`}
        >
          <g
            className="avatar-route"
            style={
              {
                "--start-x": `${start[0] - target[0]}px`,
                "--start-y": `${start[1] - target[1]}px`,
                "--door-x": `${626 - target[0]}px`,
                "--door-y": `${501 - target[1]}px`,
                "--hall-x": `${626 - target[0]}px`,
                "--hall-y": `${425 - target[1]}px`,
              } as CSSProperties
            }
          >
            <ellipse
              cx="14"
              cy="46"
              rx="19"
              ry="6"
              fill="#203a35"
              opacity=".25"
            />
            <rect x="1" y="0" width="26" height="15" fill="#544a4a" />
            <rect x="5" y="9" width="20" height="16" fill="#eec39d" />
            <rect x="3" y="7" width="8" height="8" fill="#544a4a" />
            <rect x="18" y="15" width="3" height="3" fill="#3c4540" />
            <rect x="2" y="24" width="26" height="18" fill="#dc9b76" />
            <rect x="0" y="27" width="5" height="12" fill="#eec39d" />
            <rect x="26" y="27" width="5" height="12" fill="#eec39d" />
            <rect x="6" y="42" width="8" height="8" fill="#526c65" />
            <rect x="18" y="42" width="8" height="8" fill="#526c65" />
            {world.presence === "away" && (
              <rect x="-5" y="22" width="10" height="18" fill="#8b7156" />
            )}
            {studying && (
              <g className="study-book">
                <path d="M-4 33h17v14H-4Zm18 0h17v14H14Z" fill="#f7e8bc" />
                <path d="M13 33v14" stroke="#b08559" strokeWidth="2" />
              </g>
            )}
          </g>
        </g>
        <g
          transform="translate(757 563)"
          className={world.alert ? "pixel-mailbox has-mail" : "pixel-mailbox"}
          key={world.alert?.at ?? "mail"}
        >
          <rect x="12" y="16" width="8" height="48" fill="#836d55" />
          <path d="M0 0H35V28H0Z" fill="#b77867" />
          <rect x="6" y="10" width="23" height="4" fill="#503f3b" />
          <rect
            x="29"
            y="-8"
            width="7"
            height="15"
            fill={world.alert ? "#ef8676" : "#e8c78b"}
          />
        </g>
        {world.alert && (
          <g
            className="guard-door-impact"
            key={guardImpact || world.alert.at}
            aria-label="Door unlock denied"
          >
            <path
              d="M771 578Q714 605 641 531"
              fill="none"
              stroke="#f49378"
              strokeWidth="4"
              strokeDasharray="7 7"
            />
            <path
              d="M641 501l30 10v23q-1 24-30 40-29-16-30-40v-23Z"
              fill="#465b69"
              stroke="#ffe4a5"
              strokeWidth="4"
            />
            <path
              d="M627 535l10 10 19-25"
              fill="none"
              stroke="#ffe4a5"
              strokeWidth="5"
            />
            <text
              x="641"
              y="589"
              textAnchor="middle"
              fontSize="12"
              fontFamily="monospace"
              fill="#ffd2a6"
            >
              BLOCKED
            </text>
          </g>
        )}
        <text
          x="43"
          y="50"
          fill={night ? "#d2e1ce" : "#eef2d9"}
          fontSize="12"
          fontFamily="monospace"
          letterSpacing="2"
        >
          MIKA&apos;S LITTLE WORLD
        </text>
        {night && (
          <g fill="#ece4bb" className="night-stars">
            <path d="M849 47h21v7h-7v14h-14v-7h-7V47Z" />
            {[
              { x: 63, y: 31 },
              { x: 307, y: 45 },
              { x: 511, y: 34 },
              { x: 890, y: 116 },
              { x: 867, y: 467 },
            ].map(({ x, y }) => (
              <path key={x} d={`M${x} ${y}h4v-4h4v4h4v4h-4v4h-4v-4h-4Z`} />
            ))}
          </g>
        )}
      </svg>
      <div className="scene-inspection" aria-live="polite">
        {inspected}
      </div>
    </div>
  );
}
