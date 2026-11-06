export function VoidWash() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden mix-blend-screen">
      <div
        className="absolute inset-[-20%] animate-drift opacity-40 mix-blend-lighten blur-[60px]"
        style={{ background: "radial-gradient(ellipse at 50% 50%, #163A5C 0%, #0B1C33 30%, transparent 60%)" }}
      />
      <div
        className="absolute inset-[-10%] animate-[antiq-nebula-drift_35s_linear_infinite_alternate_reverse] opacity-30 mix-blend-screen blur-[80px]"
        style={{ background: "radial-gradient(circle at 30% 70%, #6A8FBF 0%, transparent 40%)" }}
      />
    </div>
  );
}
