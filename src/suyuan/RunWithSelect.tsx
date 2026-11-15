// suyuan fork: the Automations form's choice of what a scheduled run costs (./run-with.ts).
import { Select } from "@/components/Select";
import { cn } from "@/lib/cn";
import { modelFor, type RunWithChoice } from "./run-with";

const HELP: Record<RunWithChoice, string> = {
  bot: "每次都用这个 bot 自己的模型跑，适合要查、要判断的任务。",
  haiku: "每次用最便宜的 Haiku 跑，适合只是查一下、转述一下的简单任务。",
  sonnet: "每次用中等价位的 Sonnet 跑。",
  none: "不调用模型：到点把上面写的内容原样发给你，不花 token。上面要写成你到时候想看到的那句话。",
};

export function RunWithSelect({ value, onChange, engine, indent, command }: {
  /** The command this routine runs first, set by a bot; shown, not edited here. */
  command?: string;
  /** Lines up with the form's other boxes, which sit right of its icon column. */
  indent?: boolean;
  value: RunWithChoice;
  onChange: (value: RunWithChoice) => void;
  engine: Parameters<typeof modelFor>[1];
}) {
  const offered = (choice: RunWithChoice) => choice === value || modelFor(choice, engine) !== undefined;
  return (
    <div className={cn("rounded-xl border border-hairline/40 bg-inset/40 px-3.5 py-3", indent && "ml-8")} data-run-with={value}>
      <label className="flex items-center justify-between gap-3 text-[13px] text-ink">
        <span>用什么跑</span>
        <Select aria-label="用什么跑" size="sm" value={value} onChange={(event) => onChange(event.target.value as RunWithChoice)}>
          <option value="bot">bot 自己的模型</option>
          {offered("haiku") && <option value="haiku">Haiku（便宜）</option>}
          {offered("sonnet") && <option value="sonnet">Sonnet</option>}
          <option value="none">不调模型，原样发送</option>
        </Select>
      </label>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary">{HELP[value]}</p>
      {command && <p className="mt-1.5 break-all text-[11px] leading-relaxed text-ink-secondary" data-check-first>每次先跑一条命令 <code className="font-mono text-ink">{command}</code>，不调模型；成功才往下走，没到就安静跳过。</p>}
    </div>
  );
}
