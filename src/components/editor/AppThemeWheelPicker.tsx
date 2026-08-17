import Wheel from "@uiw/react-color-wheel";
import ShadeSlider from "@uiw/react-color-shade-slider";
import { hexToHsva, hsvaToHex, type HsvaColor } from "@uiw/color-convert";
import { normalizeHex } from "@/utils/themeColors";

export interface AppThemeWheelPickerProps {
  color: string;
  onChange: (hex: string) => void;
  /** Wheel diameter in px (default 168). */
  size?: number;
}

export function AppThemeWheelPicker({ color, onChange, size = 168 }: AppThemeWheelPickerProps) {
  const safeHex = normalizeHex(color) ?? "#16171a";
  const hsva = hexToHsva(safeHex);

  const applyHsva = (next: HsvaColor) => {
    const hex = normalizeHex(hsvaToHex(next));
    if (hex) onChange(hex);
  };

  return (
    <div className="flex flex-col items-center gap-3 p-1">
      <Wheel
        color={hsva}
        width={size}
        height={size}
        onChange={(c) => applyHsva({ ...hsva, ...c.hsva })}
      />
      <ShadeSlider
        hsva={hsva}
        style={{ width: size, borderRadius: 6 }}
        onChange={(c) => applyHsva({ ...hsva, v: c.v })}
      />
      <div className="flex items-center gap-2">
        <span
          className="h-5 w-5 rounded border border-white/20"
          style={{ backgroundColor: safeHex }}
        />
        <span className="font-mono text-[10px] text-text-muted">{safeHex}</span>
      </div>
    </div>
  );
}
