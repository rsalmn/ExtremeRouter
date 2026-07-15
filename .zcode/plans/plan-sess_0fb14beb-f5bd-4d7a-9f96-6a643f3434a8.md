## Plan: Combos Page Total Redesign

### Struktur: 3 Tab (URL-synced, mirip Usage page)

```
/ dashboard / combos?tab=overview    → KPI summary + combo health
/ dashboard / combos?tab=combos      → list + search/filter + expandable cards
/ dashboard / combos?tab=templates   → template gallery
```

### File Structure (modular, mirip Usage redesign)

**Split page.js (722 lines) → ~280 lines + components/:**
```
src/app/(dashboard)/dashboard/combos/
  page.js                          → tab router + data fetch + modals (~200 lines)
  components/
    ComboOverview.js               → KPI cards + combo health summary
    ComboList.js                   → search/filter + combo list container
    ComboCard.js                   → expandable card dengan drag-reorder + strategy indicator
    ComboTemplatesTab.js           → template gallery (moved from ComboTemplates.js)
    ComboFormModal.js              → extracted dari page.js (create/edit form)
    ModelItem.js                   → drag-and-drop model row (extracted dari page.js)
    helpers.js                     → strategy metadata, format helpers
```

### Tab 1: Overview
- **KPI Row**: Total Combos, Active Models (unique), Strategies Used, Avg Models per Combo
- **Combo Health Summary**: table/list showing setiap combo dengan status indicator (connected/missing providers), strategy badge, model count
- **Strategy Distribution**: donut atau bar chart showing berapa combo pakai fallback vs round-robin vs fusion vs swarm

### Tab 2: Combos (main list)
- **Search bar**: filter by name, provider, strategy
- **Filter chips**: All / Fallback / Round Robin / Fusion / Swarm
- **ComboCard (redesigned)**:
  - Collapsed: icon + name + model chips (first 3 + "+N more") + strategy badge dengan visual indicator
  - Strategy visual indicator: layered bars (fallback), circular arrows (round-robin), fusion symbol, swarm dots
  - Expanded: full model list dengan drag-to-reorder (inline, no modal needed untuk reorder), strategy config, per-model stats
  - Actions: copy name, edit (opens form modal), delete, test
  - Drag-reorder pakai @dnd-kit (sudah imported)

### Tab 3: Templates
- Gallery grid dengan lebih visual tiles
- Provider availability badges (connected/missing)
- One-click apply
- Kategori grouping (reliability, speed, coding, dst.)

### ComboCard Strategy Visual Indicators

| Strategy | Visual |
|---|---|
| Fallback | Layered stack bars (▼) |
| Round Robin | Circular rotation arrows (↻) |
| Fusion | Merge/fork symbol (◇) |
| Swarm | Multi-node dots (⬡) |

### Search & Filter
- Text search: combo name, model name, provider alias
- Filter chips by strategy type
- Sort by: name, model count, last modified

### Komponen Reusable (dari shared/components)
- `SegmentedControl` — tab switcher
- `PageHeader` — page header
- `Card`, `Badge`, `Button`, `Modal`, `ConfirmModal`, `ModelSelectModal`
- `EmptyState` — empty combo list
- `CapacityBadges` — model capability badges
- `@dnd-kit` — drag-reorder (already in deps)

### Extract dari page.js (mengurangi dari 722 → ~200 lines)
1. `ComboCard` (lines 250-422) → `ComboCard.js`
2. `ModelItem` (lines 424-520) → `ModelItem.js`
3. `ComboFormModal` (lines 522-722) → `ComboFormModal.js`
4. Strategy constants + helpers → `helpers.js`

### Build verify di akhir