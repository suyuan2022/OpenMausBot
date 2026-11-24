// suyuan fork: the Settings switch for the composer's voice-call button (src/suyuan/voice-button.ts).
import { SettingRow, Switch } from "@/components/SettingsPrimitives";
import { setVoiceButton, useVoiceButton } from "./voice-button";

const TITLE = "显示语音对话按钮";

export function VoiceButtonRow() {
  const on = useVoiceButton();
  return (
    <SettingRow title={TITLE} subtitle="输入框右下角的语音对话（实时通话）图标，默认不显示。">
      <Switch checked={on} aria-label={TITLE} onClick={() => setVoiceButton(!on)} />
    </SettingRow>
  );
}
