import antiqLogo from "@/assets/antiq-logo.png";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

type AntiqLogoProps = {
  className: string;
  imageScaleClass: string;
  testId?: string;
  backArrow?: boolean;
  onClick?: () => void;
};

/**
 * The source artwork has two separate blue forms. Keeping each form on its
 * own clipped image layer lets us preserve the native silhouette, then open
 * the existing diagonal gap without stretching or cropping either half.
 */
export function AntiqLogo({
  className,
  imageScaleClass,
  testId,
  backArrow = false,
  onClick,
}: AntiqLogoProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const showBackArrow = backArrow && (isHovered || isFocused);

  return (
    <span
      className={`group relative block shrink-0 overflow-visible ${className}`}
      role={onClick ? "button" : "img"}
      aria-label="antiq"
      data-testid={testId}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onClick={onClick}
      onKeyDown={onClick ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      } : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {backArrow && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute -left-10 top-1/2 z-0 flex h-9 w-8 -translate-y-1/2 items-center justify-center text-muted transition-all duration-300 ease-out ${
            showBackArrow ? "translate-x-0 opacity-100" : "translate-x-3 opacity-0"
          }`}
        >
          <ArrowLeft className="h-7 w-7" strokeWidth={1.8} />
        </span>
      )}
      <img
        src={antiqLogo}
        alt=""
        aria-hidden="true"
        className={`antiq-logo-piece pointer-events-none absolute left-1/2 top-1/2 z-10 max-w-none ${imageScaleClass}`}
        style={{
          clipPath:
            "polygon(37.9% 30.6%, 56.7% 30.6%, 56.7% 39.2%, 47% 49%, 44.5% 49%, 37.9% 55.5%)",
          transform: isHovered
            ? "translate(-50%, calc(-50% - 10px))"
            : "translate(-50%, -50%)",
        }}
      />
      <img
        src={antiqLogo}
        alt=""
        aria-hidden="true"
        className={`antiq-logo-piece pointer-events-none absolute left-1/2 top-1/2 max-w-none ${imageScaleClass}`}
        style={{
          clipPath:
            "polygon(43.7% 60.5%, 55.3% 50.8%, 55.5% 50.8%, 62.2% 43.8%, 62.2% 67.4%, 43.7% 67.4%)",
          transform: isHovered
            ? "translate(-50%, calc(-50% + 10px))"
            : "translate(-50%, -50%)",
        }}
      />
    </span>
  );
}
