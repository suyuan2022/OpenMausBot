// suyuan fork: the Settings switch for the chat dock's Skill Burger card (src/suyuan/skill-burger.ts).
import { SettingRow, Switch } from "@/components/SettingsPrimitives";
import { setSkillBurger, useSkillBurger } from "./skill-burger";

const TITLE = "显示任务步骤卡片";

export function SkillBurgerRow() {
  const on = useSkillBurger();
  return (
    <SettingRow title={TITLE} subtitle="对话底部自动弹出的多步骤操作记录卡片（Skill Burger），默认不显示。">
      <Switch checked={on} aria-label={TITLE} onClick={() => setSkillBurger(!on)} />
    </SettingRow>
  );
}
