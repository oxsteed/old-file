import { Card } from "../components/Card";
import { Screen } from "../components/Screen";
import { AppText } from "../components/Text";

export function PlaceholderScreen({ title, body }: { title: string; body: string }) {
  return (
    <Screen>
      <Card>
        <AppText variant="caption">FEATURE FLAGGED</AppText>
        <AppText variant="title">{title}</AppText>
        <AppText variant="muted">{body}</AppText>
      </Card>
    </Screen>
  );
}
