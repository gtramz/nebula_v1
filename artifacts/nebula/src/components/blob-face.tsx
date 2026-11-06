import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type EyeStyle = "bars" | "dots" | "sleepy" | "wink" | "side";
type FaceMood = "happy" | "angry";

type FaceParams = {
  radii: number[];
  wobble: number;
  scale: number;
  face: string;
  eyes: EyeStyle;
};

type MorphAdvanceButtonProps = {
  children: ReactNode;
  onAdvance: () => void;
  onBeforeAdvance?: () => boolean;
  onPendingChange?: (pending: boolean) => void;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  faceSize?: number;
};

const HAPPY_COLORS = ["#ff5a3c", "#2b3cff", "#ffb02e", "#cdf03f"];
const EYE_STYLES: EyeStyle[] = ["bars", "dots", "side", "wink", "sleepy"];

function randomFace(previous: FaceParams | null): FaceParams {
  const availableColors = HAPPY_COLORS.filter((color) => color !== previous?.face);
  const availableEyes = EYE_STYLES.filter((eyes) => eyes !== previous?.eyes);

  return {
    radii: Array.from({ length: 8 }, () => Math.random()),
    wobble: 0.42 + Math.random() * 0.43,
    scale: 0.84 + Math.random() * 0.16,
    face: availableColors[Math.floor(Math.random() * availableColors.length)],
    eyes: availableEyes[Math.floor(Math.random() * availableEyes.length)],
  };
}

function angryFace(): FaceParams {
  return {
    radii: Array.from({ length: 8 }, () => Math.random()),
    wobble: 0.55 + Math.random() * 0.3,
    scale: 0.86 + Math.random() * 0.14,
    face: "#ff5a3c",
    eyes: "bars",
  };
}

function blobPath({ radii, wobble, scale }: FaceParams) {
  const center = 256;
  const baseRadius = 512 * 0.335;
  const points = radii.map((radius, index) => {
    const angle = (index / 8) * Math.PI * 2 - Math.PI / 2;
    const factor = 1 + wobble * 0.26 * (radius * 2 - 1);
    const distance = baseRadius * scale * factor;
    return {
      x: center + Math.cos(angle) * distance,
      y: center + Math.sin(angle) * distance,
    };
  });

  return points.reduce((path, point, index) => {
    const next = points[(index + 1) % points.length];
    const previous = points[(index + points.length - 1) % points.length];
    const afterNext = points[(index + 2) % points.length];
    const controlOne = {
      x: point.x + (next.x - previous.x) * 0.14,
      y: point.y + (next.y - previous.y) * 0.14,
    };
    const controlTwo = {
      x: next.x - (afterNext.x - point.x) * 0.14,
      y: next.y - (afterNext.y - point.y) * 0.14,
    };

    if (index === 0) {
      return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)} C ${controlOne.x.toFixed(1)} ${controlOne.y.toFixed(1)}, ${controlTwo.x.toFixed(1)} ${controlTwo.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }
    return `${path} C ${controlOne.x.toFixed(1)} ${controlOne.y.toFixed(1)}, ${controlTwo.x.toFixed(1)} ${controlTwo.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }, "") + " Z";
}

function Eye({ style, side }: { style: EyeStyle; side: "left" | "right" }) {
  const x = side === "left" ? 192 : 320;

  if (style === "dots") {
    return <circle cx={x} cy="222" r="13" fill="#080808" />;
  }
  if (style === "sleepy") {
    return (
      <path
        d={side === "left" ? "M178 220 Q192 232 206 220" : "M306 220 Q320 232 334 220"}
        fill="none"
        stroke="#080808"
        strokeLinecap="round"
        strokeWidth="12"
      />
    );
  }
  if (style === "wink" && side === "right") {
    return <circle cx={x} cy="222" r="13" fill="#080808" />;
  }
  if (style === "side") {
    return <circle cx={x + (side === "left" ? 7 : -7)} cy="222" r="13" fill="#080808" />;
  }
  return <rect x={x - 11} y="188" width="22" height="68" rx="11" fill="#080808" />;
}

function SpringFace({
  mood,
  params,
  size,
}: {
  mood: FaceMood;
  params: FaceParams;
  size: number;
}) {
  const reduceMotion = useReducedMotion();
  const path = blobPath(params);
  const spring = reduceMotion ? { duration: 0.01 } : { type: "spring" as const, stiffness: 340, damping: 20 };

  return (
    <motion.div
      key={`${mood}-${params.face}-${params.radii[0]}`}
      initial={{ scale: 0, opacity: 0, rotate: -18 }}
      animate={mood === "angry" && !reduceMotion
        ? { scale: 1, opacity: 1, rotate: 0, x: [0, -6, 6, -5, 5, -3, 0] }
        : { scale: 1, opacity: 1, rotate: 0 }}
      exit={{ scale: 0, opacity: 0, rotate: 18 }}
      transition={mood === "angry" && !reduceMotion
        ? { ...spring, x: { delay: 0.5, duration: 0.45 } }
        : spring}
      layout
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 512 512" className="h-full w-full overflow-visible">
        <path d={path} fill={params.face} />
        <motion.g
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduceMotion ? { duration: 0.01 } : { delay: 0.18, type: "spring", stiffness: 500, damping: 18 }}
          style={{ transformOrigin: "256px 222px" }}
        >
          <Eye style={params.eyes} side="left" />
        </motion.g>
        <motion.g
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduceMotion ? { duration: 0.01 } : { delay: 0.24, type: "spring", stiffness: 500, damping: 18 }}
          style={{ transformOrigin: "320px 222px" }}
        >
          <Eye style={params.eyes} side="right" />
        </motion.g>
        {mood === "angry" && (
          <motion.g
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduceMotion ? { duration: 0.01 } : { delay: 0.24, type: "spring", stiffness: 500, damping: 18 }}
            fill="none"
            stroke="#080808"
            strokeLinecap="round"
            strokeWidth="13"
          >
            <path d="M166 166 L215 185" />
            <path d="M297 185 L346 166" />
          </motion.g>
        )}
        <motion.path
          d={mood === "angry" ? "M184 355 Q256 286 328 355" : "M184 318 Q256 386 328 318"}
          fill="none"
          stroke="#080808"
          strokeLinecap="round"
          strokeWidth="13"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={reduceMotion ? { duration: 0.01 } : { delay: 0.32, duration: mood === "angry" ? 0.35 : 0.4 }}
        />
      </svg>
    </motion.div>
  );
}

export function MorphAdvanceButton({
  children,
  onAdvance,
  onBeforeAdvance,
  onPendingChange,
  invalid = false,
  disabled = false,
  className = "",
  buttonClassName = "",
  faceSize = 80,
}: MorphAdvanceButtonProps) {
  const [mood, setMood] = useState<FaceMood | null>(null);
  const [face, setFace] = useState<FaceParams | null>(null);
  const previousFace = useRef<FaceParams | null>(null);
  const settleTimer = useRef<number | null>(null);
  const settled = useRef(false);
  const reduceMotion = useReducedMotion();

  const clearPending = useCallback(() => {
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    onPendingChange?.(false);
  }, [onPendingChange]);

  useEffect(() => () => clearPending(), [clearPending]);

  const handleClick = () => {
    if (disabled || mood) return;

    const nativeValid = onBeforeAdvance ? onBeforeAdvance() : true;
    const isRejected = invalid || !nativeValid;
    const nextMood: FaceMood = isRejected ? "angry" : "happy";
    const nextFace = isRejected ? angryFace() : randomFace(previousFace.current);

    settled.current = false;
    previousFace.current = nextFace;
    setFace(nextFace);
    setMood(nextMood);
    onPendingChange?.(true);

    settleTimer.current = window.setTimeout(() => {
      if (settled.current) return;
      settled.current = true;
      setMood(null);
      setFace(null);

      // AnimatePresence needs to finish the face exit before either restoring
      // the CTA or moving the wizard to its next panel.
      settleTimer.current = window.setTimeout(() => {
        clearPending();
        if (!isRejected) onAdvance();
      }, 220);
    }, isRejected ? 1250 : 1050);
  };

  return (
    <div className={`relative flex h-20 items-center justify-end ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        {mood && face ? (
          <SpringFace key="face" mood={mood} params={face} size={faceSize} />
        ) : (
          <motion.button
            key="button"
            type="button"
            onClick={handleClick}
            disabled={disabled}
            layout
            initial={reduceMotion ? { scale: 1, opacity: 1 } : { scale: 0.94, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={reduceMotion
              ? { opacity: 0, transition: { duration: 0.01 } }
              : { scale: 0.92, opacity: 0, y: -4, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={reduceMotion
              ? { duration: 0.01 }
              : { type: "spring", stiffness: 420, damping: 26, mass: 0.7 }}
            className={buttonClassName}
          >
            {children}
          </motion.button>
        )}
      </AnimatePresence>
      <span className="sr-only" role="status" aria-live="polite">
        {mood === "happy"
          ? "continuing to the next step"
          : mood === "angry"
            ? "some required input is missing or invalid — fix it to continue"
            : ""}
      </span>
    </div>
  );
}
