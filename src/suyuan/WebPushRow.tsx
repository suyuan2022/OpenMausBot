// suyuan fork: the "push to this device" switch under the device notification rows (src/suyuan/web-push.ts).
import { useEffect, useState } from "react";
import { SettingRow, Switch } from "@/components/SettingsPrimitives";
import { currentSubscription, needsHomeScreen, sendTestPush, turnOffPush, turnOnPush, webPushSupported } from "./web-push";

const TITLE = "推送到这台设备";

export function WebPushRow() {
  const supported = webPushSupported();
  const [on, setOn] = useState<boolean | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (supported) void currentSubscription().then((subscription) => setOn(Boolean(subscription)), () => setOn(false));
  }, [supported]);

  if (!supported) {
    if (!needsHomeScreen()) return null;
    return (
      <SettingRow title={TITLE} subtitle="在 Safari 里点分享，选「添加到主屏幕」，再从主屏幕图标打开，这里就能开启。">
        <Switch checked={false} disabled aria-label={TITLE} />
      </SettingRow>
    );
  }

  const toggle = async () => {
    setWorking(true);
    setProblem(null);
    try {
      if (on) {
        await turnOffPush();
        setOn(false);
      } else {
        const subscription = await turnOnPush();
        setOn(true);
        const { ok } = await sendTestPush(subscription.endpoint);
        if (!ok) setProblem("已开启，但测试推送没发出去，看看服务端日志里的 [web-push]。");
      }
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  };

  const subtitle = problem
    ?? (on ? "已开启：bot 回完、提问、要你审批时，锁屏也会收到通知，点开直接进那个对话。" : "App 关着或手机锁屏时，也能收到 bot 的通知。");
  return (
    <SettingRow title={TITLE} subtitle={subtitle}>
      <Switch checked={on === true} disabled={working || on === null} aria-label={TITLE} onClick={() => void toggle()} />
    </SettingRow>
  );
}
