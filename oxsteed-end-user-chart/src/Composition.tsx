import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
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

const promoColors = {
  ink: "#111820",
  paper: "#F7F4EC",
  teal: "#12B5CB",
  gold: "#F3B23C",
  coral: "#EF5B5B",
  green: "#58A36C",
  blue: "#3457D5",
};

const services = [
  { title: "Move", detail: "Local help", color: promoColors.teal },
  { title: "Fix", detail: "Trusted pros", color: promoColors.gold },
  { title: "Deliver", detail: "Real-time tracking", color: promoColors.coral },
  { title: "Grow", detail: "Business support", color: promoColors.green },
] as const;

const metricCards = [
  { value: "24/7", label: "requests" },
  { value: "Fast", label: "matching" },
  { value: "Clear", label: "updates" },
] as const;

const ease = Easing.bezier(0.16, 1, 0.3, 1);

const fadeUp = (frame: number, start: number, end: number, distance = 42) => {
  const progress = interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return {
    opacity: progress,
    transform: `translateY(${(1 - progress) * distance}px)`,
  };
};

const BrandMark = ({ scale = 1 }: { scale?: number }) => (
  <div
    style={{
      width: 86 * scale,
      height: 86 * scale,
      borderRadius: 26 * scale,
      background: promoColors.ink,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 ${20 * scale}px ${42 * scale}px rgba(17, 24, 32, 0.22)`,
    }}
  >
    <div
      style={{
        width: 44 * scale,
        height: 44 * scale,
        borderRadius: 14 * scale,
        border: `${7 * scale}px solid ${promoColors.paper}`,
        transform: "rotate(-12deg)",
      }}
    />
  </div>
);

const PhoneMock = ({ frame }: { frame: number }) => {
  const cardIn = fadeUp(frame, 36, 58, 34);
  const route = interpolate(frame, [70, 130], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 118,
        top: 560,
        width: 844,
        height: 760,
        borderRadius: 54,
        background: "#FFFFFF",
        border: "3px solid rgba(17, 24, 32, 0.08)",
        boxShadow: "0 38px 90px rgba(17, 24, 32, 0.18)",
        overflow: "hidden",
        ...cardIn,
      }}
    >
      <div
        style={{
          height: 104,
          padding: "30px 36px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "2px solid rgba(17, 24, 32, 0.07)",
        }}
      >
        <div style={{ fontSize: 31, fontWeight: 860 }}>Today on OxSteed</div>
        <div
          style={{
            borderRadius: 999,
            background: "rgba(18, 181, 203, 0.13)",
            color: promoColors.teal,
            padding: "12px 20px",
            fontSize: 23,
            fontWeight: 800,
          }}
        >
          Live
        </div>
      </div>

      <div style={{ position: "absolute", inset: "132px 38px 40px" }}>
        <div
          style={{
            position: "absolute",
            left: 58,
            top: 38,
            width: 650,
            height: 330,
            borderRadius: 34,
            background:
              "linear-gradient(135deg, rgba(18,181,203,0.17), rgba(243,178,60,0.14), rgba(239,91,91,0.12))",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 132,
            top: 160,
            width: 500 * route,
            height: 10,
            borderRadius: 10,
            background: promoColors.teal,
            boxShadow: "0 14px 30px rgba(18, 181, 203, 0.28)",
          }}
        />
        {[0, 1, 2].map((dot) => {
          const visible = interpolate(frame, [72 + dot * 17, 86 + dot * 17], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          });
          return (
            <div
              key={dot}
              style={{
                position: "absolute",
                left: 124 + dot * 250,
                top: dot === 1 ? 132 : 154,
                width: 42,
                height: 42,
                borderRadius: 21,
                background: [promoColors.teal, promoColors.coral, promoColors.green][dot],
                opacity: visible,
                transform: `scale(${0.7 + visible * 0.3})`,
                border: "6px solid #FFFFFF",
              }}
            />
          );
        })}

        <div
          style={{
            position: "absolute",
            left: 42,
            right: 42,
            bottom: 18,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 22,
          }}
        >
          {services.map((service, index) => {
            const show = fadeUp(frame, 112 + index * 7, 130 + index * 7, 22);
            return (
              <div
                key={service.title}
                style={{
                  borderRadius: 26,
                  padding: "24px 24px 22px",
                  background: "rgba(17, 24, 32, 0.045)",
                  ...show,
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: service.color,
                    marginBottom: 14,
                  }}
                />
                <div style={{ fontSize: 34, fontWeight: 870 }}>{service.title}</div>
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 22,
                    fontWeight: 650,
                    color: "rgba(17, 24, 32, 0.62)",
                  }}
                >
                  {service.detail}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export const OxsteedPromo = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const brandScale = spring({
    frame,
    fps,
    config: { damping: 120, stiffness: 95, mass: 0.7 },
  });
  const phoneLift = interpolate(frame, [150, 184], [0, -250], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const wipe = interpolate(frame, [214, 246], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

  return (
    <AbsoluteFill
      style={{
        background: promoColors.paper,
        color: promoColors.ink,
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 14% 14%, rgba(18,181,203,0.20), transparent 30%), radial-gradient(circle at 84% 20%, rgba(239,91,91,0.16), transparent 34%), linear-gradient(180deg, #F7F4EC, #FFFFFF 62%, #F7F4EC)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: -120,
          top: 1260,
          width: 1320,
          height: 520,
          background: promoColors.ink,
          borderRadius: "50% 50% 0 0",
          transform: `translateY(${interpolate(frame, [15, 60], [170, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          })}px)`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 74,
          display: "flex",
          alignItems: "center",
          gap: 22,
          opacity: interpolate(frame, [0, 20], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        <BrandMark scale={0.72 + brandScale * 0.28} />
        <div style={{ fontSize: 54, fontWeight: 900, letterSpacing: 0 }}>OxSteed</div>
      </div>

      <Sequence durationInFrames={96}>
        <div
          style={{
            position: "absolute",
            left: 72,
            right: 72,
            top: 270,
            ...fadeUp(frame, 8, 32, 48),
          }}
        >
          <div
            style={{
              fontSize: 116,
              lineHeight: 0.94,
              fontWeight: 950,
              letterSpacing: 0,
            }}
          >
            Help shows up when life moves.
          </div>
          <div
            style={{
              marginTop: 34,
              width: 780,
              fontSize: 38,
              lineHeight: 1.15,
              fontWeight: 680,
              color: "rgba(17, 24, 32, 0.66)",
            }}
          >
            Book trusted local services, manage requests, and keep every update in one place.
          </div>
        </div>
      </Sequence>

      <div style={{ transform: `translateY(${phoneLift}px)` }}>
        <PhoneMock frame={frame} />
      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          top: 1370,
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 18,
        }}
      >
        {metricCards.map((card, index) => {
          const show = fadeUp(frame, 154 + index * 6, 174 + index * 6, 28);
          return (
            <div
              key={card.label}
              style={{
                borderRadius: 28,
                padding: "30px 24px",
                background: "#FFFFFF",
                boxShadow: "0 22px 46px rgba(17, 24, 32, 0.14)",
                ...show,
              }}
            >
              <div style={{ fontSize: 48, fontWeight: 920 }}>{card.value}</div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 23,
                  fontWeight: 760,
                  color: "rgba(17, 24, 32, 0.58)",
                  textTransform: "uppercase",
                  letterSpacing: 0,
                }}
              >
                {card.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 72,
          right: 72,
          bottom: 98,
          color: promoColors.paper,
          ...fadeUp(frame, 184, 208, 34),
        }}
      >
        <div style={{ fontSize: 78, lineHeight: 0.98, fontWeight: 940 }}>
          One platform for getting it done.
        </div>
        <div
          style={{
            marginTop: 30,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 750, color: "rgba(247,244,236,0.76)" }}>
            Customers. Helpers. Businesses.
          </div>
          <div
            style={{
              borderRadius: 999,
              padding: "20px 28px",
              background: promoColors.teal,
              color: "#FFFFFF",
              fontSize: 30,
              fontWeight: 860,
            }}
          >
            Start with OxSteed
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: promoColors.ink,
          transform: `translateY(${(1 - wipe) * 1920}px)`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: promoColors.paper,
        }}
      >
        <BrandMark scale={1.35} />
        <div style={{ marginTop: 42, fontSize: 104, fontWeight: 950 }}>OxSteed</div>
        <div
          style={{
            marginTop: 18,
            fontSize: 38,
            fontWeight: 720,
            color: "rgba(247, 244, 236, 0.72)",
          }}
        >
          Move faster. Hire smarter. Stay connected.
        </div>
      </div>
    </AbsoluteFill>
  );
};
