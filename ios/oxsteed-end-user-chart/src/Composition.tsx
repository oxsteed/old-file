import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const bars = [
  { label: "Discover", value: 78, color: "#12B5CB" },
  { label: "Compare", value: 64, color: "#F3B23C" },
  { label: "Book", value: 91, color: "#EF5B5B" },
  { label: "Track", value: 58, color: "#58A36C" },
  { label: "Repeat", value: 84, color: "#7B61FF" },
] as const;

const chartHeight = 360;
const maxValue = 100;

export const OxsteedEndUserChart = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const intro = interpolate(frame, [0, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const headlineY = interpolate(frame, [0, 24], [18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  const average =
    bars.reduce((total, item) => total + item.value, 0) / bars.length;

  const averageProgress = interpolate(frame, [62, 98], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill
      style={{
        background: "#F7F4EC",
        color: "#171A1C",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(135deg, rgba(18,181,203,0.18), rgba(239,91,91,0.08) 43%, rgba(88,163,108,0.16))",
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 86,
          top: 68,
          opacity: intro,
          transform: `translateY(${headlineY}px)`,
        }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#EF5B5B",
            textTransform: "uppercase",
            letterSpacing: 0,
          }}
        >
          OxSteed End User Flow
        </div>
        <div
          style={{
            marginTop: 12,
            fontSize: 58,
            fontWeight: 860,
            lineHeight: 1,
            color: "#171A1C",
          }}
        >
          Momentum across the journey
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 92,
          top: 82,
          width: 214,
          opacity: interpolate(frame, [18, 44], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <div
          style={{
            fontSize: 74,
            fontWeight: 850,
            lineHeight: 1,
            color: "#171A1C",
          }}
        >
          {Math.round(average * averageProgress)}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 20,
            fontWeight: 650,
            color: "#4D5458",
          }}
        >
          average engagement score
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 98,
          right: 98,
          bottom: 78,
          height: 430,
          display: "flex",
          alignItems: "flex-end",
          gap: 38,
          padding: "0 22px 0 86px",
        }}
      >
        {[0, 25, 50, 75, 100].map((tick) => (
          <div
            key={tick}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: (tick / maxValue) * chartHeight + 54,
              height: 1,
              background:
                tick === 0 ? "rgba(23,26,28,0.45)" : "rgba(23,26,28,0.11)",
              opacity: interpolate(frame, [10, 36], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                top: -13,
                fontSize: 16,
                fontWeight: 650,
                color: "rgba(23,26,28,0.52)",
              }}
            >
              {tick}
            </span>
          </div>
        ))}

        {bars.map((bar, index) => {
          const grow = spring({
            frame,
            fps,
            delay: 22 + index * 7,
            config: {
              damping: 170,
              stiffness: 95,
              mass: 0.78,
            },
          });
          const height = (bar.value / maxValue) * chartHeight * grow;
          const labelIn = interpolate(frame, [58 + index * 5, 76 + index * 5], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          });
          const value = Math.round(bar.value * grow);

          return (
            <div
              key={bar.label}
              style={{
                position: "relative",
                width: 148,
                height: chartHeight + 64,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  marginBottom: 14,
                  opacity: labelIn,
                  transform: `translateY(${(1 - labelIn) * 8}px)`,
                  fontSize: 32,
                  lineHeight: 1,
                  fontWeight: 850,
                  color: "#171A1C",
                }}
              >
                {value}
              </div>
              <div
                style={{
                  width: 112,
                  height,
                  minHeight: 4,
                  borderRadius: "8px 8px 3px 3px",
                  background: `linear-gradient(180deg, ${bar.color}, ${bar.color}CC)`,
                  boxShadow: `0 22px 42px ${bar.color}45`,
                }}
              />
              <div
                style={{
                  width: "100%",
                  marginTop: 18,
                  textAlign: "center",
                  fontSize: 22,
                  fontWeight: 760,
                  color: "#30373B",
                  opacity: labelIn,
                }}
              >
                {bar.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 98,
          right: 98,
          bottom: 40,
          height: 5,
          borderRadius: 5,
          overflow: "hidden",
          background: "rgba(23,26,28,0.10)",
        }}
      >
        <div
          style={{
            width: `${interpolate(frame, [102, 142], [0, 100], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}%`,
            height: "100%",
            background:
              "linear-gradient(90deg, #12B5CB, #F3B23C, #EF5B5B, #58A36C, #7B61FF)",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
