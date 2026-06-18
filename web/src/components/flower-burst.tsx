import { useEffect, useState, type CSSProperties } from "react";

type FlowerParticle = {
  id: string;
  x: number;
  y: number;
  driftX: number;
  rise: number;
  rotate: number;
  size: number;
  delay: number;
  src: string;
};

const FLOWER_ICONS = [
  "/flowers/flower-2.png",
  "/flowers/mexican-aster.png",
  "/flowers/cherry-blossom.png",
  "/flowers/flower-1.png",
  "/flowers/tulips.png",
  "/flowers/sakura.png",
  "/flowers/flower.png",
];

const BURST_LIFETIME_MS = 1600;

export function FlowerBurst() {
  const [particles, setParticles] = useState<FlowerParticle[]>([]);

  useEffect(() => {
    function spawnParticles(x: number, y: number) {
      const nextParticles = Array.from({ length: 5 }, (_, index) => ({
        id: `${crypto.randomUUID()}-${index}`,
        x: x + randomBetween(-10, 10),
        y: y - 8 + randomBetween(-6, 6),
        driftX: randomBetween(-56, 56),
        rise: randomBetween(110, 190),
        rotate: randomBetween(-34, 34),
        size: randomBetween(30, 52),
        delay: index * 35,
        src: FLOWER_ICONS[Math.floor(Math.random() * FLOWER_ICONS.length)],
      }));

      setParticles((existing) => [...existing, ...nextParticles]);
      window.setTimeout(() => {
        setParticles((existing) =>
          existing.filter((particle) => !nextParticles.some((created) => created.id === particle.id)),
        );
      }, BURST_LIFETIME_MS + 240);
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || target.closest("input, textarea, select, [contenteditable='true']")) return;
      spawnParticles(event.clientX, event.clientY);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return (
    <div className="flower-burst-layer" aria-hidden="true">
      {particles.map((particle) => (
        <img
          key={particle.id}
          className="flower-burst-particle"
          src={particle.src}
          alt=""
          style={
            {
              left: `${particle.x}px`,
              top: `${particle.y}px`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              "--burst-drift-x": `${particle.driftX}px`,
              "--burst-rise": `${particle.rise}px`,
              "--burst-rotate": `${particle.rotate}deg`,
              "--burst-delay": `${particle.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
