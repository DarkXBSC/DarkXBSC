import { Globe } from "lucide-react";
import { useApp } from "../lib/context";

export default function LanguageSwitch({ className }: { className?: string }) {
  const { zh, toggleLang } = useApp();
  const label = zh ? "切换到英文" : "Switch to Chinese";
  return (
    <button
      type="button"
      className={className}
      onClick={toggleLang}
      aria-label={label}
      title={label}
    >
      <Globe size={14} aria-hidden="true" />
      <span lang={zh ? "en" : "zh-CN"}>{zh ? "English" : "中文"}</span>
    </button>
  );
}
