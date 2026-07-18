"use client";

import PropTypes from "prop-types";
import { Badge } from "@/shared/components";

const SAVERS = [
  { key: "rtkEnabled", name: "RTK Token Saver", icon: "compress" },
  { key: "headroomEnabled", name: "Headroom", icon: "cloud_compress" },
  { key: "pxpipeEnabled", name: "Pxpipe", icon: "image_search" },
  { key: "semanticCacheEnabled", name: "Semantic Cache", icon: "cached" },
  { key: "cavemanEnabled", name: "Caveman Mode", icon: "cottage" },
  { key: "ponytailEnabled", name: "Ponytail", icon: "cut" },
];

export default function TokenSaverStatus({ settings }) {
  if (!settings) return null;
  return (
    <div className="flex flex-wrap gap-3">
      {SAVERS.map((s) => {
        const enabled = !!settings[s.key];
        return (
          <div
            key={s.key}
            className={`flex items-center gap-2 rounded-brand border px-3 py-2 transition-colors ${
              enabled
                ? "border-success/30 bg-success/5"
                : "border-border-subtle bg-surface-2"
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] ${enabled ? "text-success" : "text-text-muted"}`}>
              {s.icon}
            </span>
            <span className="text-sm font-medium text-text-main">{s.name}</span>
            <Badge variant={enabled ? "success" : "default"} size="sm" dot>
              {enabled ? "Active" : "Off"}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

TokenSaverStatus.propTypes = { settings: PropTypes.object };
