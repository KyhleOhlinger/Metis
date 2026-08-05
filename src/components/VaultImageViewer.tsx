import { safeConvertFileSrc } from "../utils/vaultImages";
import type { MouseEvent } from "react";
import { revealPlatformLabel, revealInFinder } from "../utils/vaultNavigation";
import { openDomContextMenu } from "../utils/domContextMenu";

interface Props {
  filePath: string;
  vaultPath: string;
  bgColor?: string;
}

export default function VaultImageViewer({ filePath, vaultPath, bgColor }: Props) {
  const src = safeConvertFileSrc(filePath, vaultPath);

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openDomContextMenu(e.clientX, e.clientY, [
      {
        label: revealPlatformLabel(),
        onClick: () => revealInFinder(filePath, vaultPath),
      },
    ]);
  };

  return (
    <div
      className="absolute inset-0 z-20 flex min-h-0 items-center justify-center overflow-auto p-6"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
      onContextMenu={onContextMenu}
    >
      <img
        src={src}
        alt=""
        className="max-h-full max-w-full rounded-md object-contain shadow-lg"
        draggable={false}
      />
    </div>
  );
}
