import "./index.css";
import { Composition } from "remotion";
import { OxsteedEndUserChart } from "./Composition";

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
    </>
  );
};
