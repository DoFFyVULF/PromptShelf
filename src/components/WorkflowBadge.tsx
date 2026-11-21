import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { useI18n } from "../i18n";

interface WorkflowBadgeProps {
  /** The JSON has been archived in the library's Workflows folder. */
  saved: boolean;
  /** Node count from the compact summary — sets the graph density and tooltip. */
  nodes: number;
  /** The tile's mount-stagger seed in ms (the shelf caps it at 320ms). */
  delay?: number;
}

type Geometry = {
  nodes: [number, number][];
  edges: [number, number][];
};

/* Four constellations in a 16×16 box, sparser → denser with the node count.
   They are the badge: a tiny, data-driven portrait of the graph itself. */
const TINY: Geometry = {
  nodes: [[3.4, 4.4], [12.2, 6.6], [6.4, 12.4]],
  edges: [[0, 1], [1, 2], [0, 2]],
};
const SMALL: Geometry = {
  nodes: [[3.2, 3.2], [12, 4], [5, 9], [12.4, 12.4]],
  edges: [[0, 1], [1, 3], [0, 2], [2, 3]],
};
const MEDIUM: Geometry = {
  nodes: [[3, 4], [11.6, 2.6], [6.4, 8.6], [13.4, 9.6], [4.4, 13]],
  edges: [[0, 1], [1, 2], [2, 3], [0, 2], [2, 4]],
};
const DENSE: Geometry = {
  nodes: [[3, 3.6], [11, 2], [7, 7.6], [13.6, 7.4], [4, 11.6], [11, 13.6]],
  edges: [[0, 1], [1, 2], [2, 0], [2, 3], [2, 4], [4, 5], [3, 5]],
};

function geometryFor(nodes: number): Geometry {
  if (nodes <= 8) return TINY;
  if (nodes <= 22) return SMALL;
  if (nodes <= 45) return MEDIUM;
  return DENSE;
}

/**
 * The workflow seal in the card's meta row: a compact pill that says the card
 * carries a ComfyUI graph, and whether that graph's JSON is on disk. Its
 * *material* carries the state, so no second accent colour is needed:
 *
 *   pending  → a dashed slot, outline only, muted ink, hollow constellation:
 *              the graph lives on CivitAI, the file is not here yet;
 *   archived → the ink fill of every primary control, filled constellation and
 *              a check: the JSON is in the Workflows folder.
 *
 * The graph itself carries the data: the constellation densifies with the node
 * count, so a 60-node monster reads differently from a 6-node sketch, and the
 * count rides along as a tabular spec.
 *
 * The pill sits in the text zone, so it never moves with the cover's hover
 * zoom; the entrance is a short staggered spring, the download → check swap is
 * keyed, and the ring stamp fires only on a real false → true flip — not on
 * every shelf mount.
 */
export function WorkflowBadge({ saved, nodes, delay = 0 }: WorkflowBadgeProps) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const graph = geometryFor(nodes);

  const hint = saved
    ? t("card.workflowSavedHint", { n: nodes })
    : t("card.workflowPendingHint", { n: nodes });

  // Only a live flip earns the stamp — cards imported months ago stay quiet.
  const wasSaved = useRef(saved);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (saved && !wasSaved.current) setStamp((n) => n + 1);
    wasSaved.current = saved;
  }, [saved]);

  return (
    <span className="wf-seal-wrap">
      <motion.span
        className={`wf-seal ${saved ? "wf-seal--saved" : "wf-seal--pending"}`}
        role="img"
        aria-label={hint}
        title={hint}
        initial={reduced ? false : { opacity: 0, y: 4, scale: 0.9 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={
          reduced
            ? { duration: 0 }
            : {
                type: "spring",
                stiffness: 460,
                damping: 27,
                delay: 0.1 + Math.min(delay, 320) / 1000,
              }
        }
      >
        {stamp > 0 && !reduced && (
          <motion.span
            key={stamp}
            aria-hidden
            className="wf-seal__stamp"
            initial={{ opacity: 0.7, scale: 0.88 }}
            animate={{ opacity: 0, scale: 1.28 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        )}

        <svg className="wf-seal__graph" viewBox="0 0 16 16" aria-hidden>
          {graph.edges.map(([a, b], i) => (
            <line
              key={`e${i}`}
              className="wf-seal__edge"
              x1={graph.nodes[a][0]}
              y1={graph.nodes[a][1]}
              x2={graph.nodes[b][0]}
              y2={graph.nodes[b][1]}
            />
          ))}
          {graph.nodes.map(([x, y], i) => {
            const last = i === graph.nodes.length - 1;
            return (
              <circle
                key={`n${i}`}
                className={`wf-seal__node${last && !saved ? " wf-seal__node--live" : ""}`}
                cx={x}
                cy={y}
                r={last ? 2.1 : 1.7}
              />
            );
          })}
        </svg>

        <span className="wf-seal__label">{t("card.workflow")}</span>
        <span className="wf-seal__count">{nodes}</span>

        <span className="wf-seal__bead" aria-hidden>
          <AnimatePresence initial={false}>
            {saved && (
              <motion.span
                key="check"
                className="wf-seal__check"
                initial={reduced ? false : { opacity: 0, scale: 0.4, rotate: -30 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                exit={reduced ? undefined : { opacity: 0, scale: 0.5 }}
                transition={
                  reduced ? { duration: 0 } : { type: "spring", stiffness: 540, damping: 24 }
                }
              >
                <Check size={9.5} strokeWidth={3.4} />
              </motion.span>
            )}
          </AnimatePresence>
        </span>
      </motion.span>
    </span>
  );
}
