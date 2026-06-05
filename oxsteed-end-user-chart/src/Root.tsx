import "./index.css";
import { Composition } from "remotion";
import { OxsteedEndUserChart, OxsteedPromo } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="OxsteedEndUserChart"
        component={OxsteedEndUserChart}
        durationInFrames={150}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="OxsteedPromo"
        component={OxsteedPromo}
        durationInFrames={270}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
