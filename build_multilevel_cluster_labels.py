import csv
import json
import os
from collections import defaultdict
from typing import Dict, List, Tuple, Set


ROOT = os.path.dirname(__file__)
PUBLIC = os.path.join(ROOT, "public")

HIER_CSV = os.path.join(PUBLIC, "cluster_multilevel_hierarchy.csv")
OLD_LABELS_JSON = os.path.join(PUBLIC, "cluster_labels.json")
OUT_JSON = os.path.join(PUBLIC, "cluster_labels_multilevel.json")


def load_hierarchy() -> Tuple[List[Dict[str, str]], Dict[Tuple[int, int], List[Tuple[int, int]]], Dict[Tuple[int, int], Tuple[int, int]], List[int]]:
    """
    Read cluster_multilevel_hierarchy.csv and build hierarchy helpers.

    Returns:
      - rows: list of dicts for each CSV row
      - children_map: (level, cluster_id) -> [(level+1, child_cluster_id), ...]
      - parents_map: (level, cluster_id) -> (parent_level, parent_cluster_id)
      - levels: sorted list of all levels that appear in the file
    """
    if not os.path.exists(HIER_CSV):
        raise FileNotFoundError(f"Hierarchy CSV not found: {HIER_CSV}")

    rows: List[Dict[str, str]] = []
    with open(HIER_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append(r)

    children_map: Dict[Tuple[int, int], List[Tuple[int, int]]] = defaultdict(list)
    parents_map: Dict[Tuple[int, int], Tuple[int, int]] = {}
    levels_set: Set[int] = set()

    for r in rows:
        level = int(r["level"])
        cid = int(r["cluster_id"])
        levels_set.add(level)

        # children
        child_str = (r.get("children_cluster_ids") or "").strip()
        if child_str:
            # May contain quotes around the list, e.g. "0,1,2"
            if child_str.startswith('"') and child_str.endswith('"'):
                child_str = child_str[1:-1]
            for x in child_str.split(","):
                x = x.strip()
                if not x:
                    continue
                child_id = int(x)
                children_map[(level, cid)].append((level + 1, child_id))

        # parents
        parent_level = int(r.get("parent_level", "-1"))
        parent_cluster_id = int(r.get("parent_cluster_id", "-1"))
        if parent_level >= 0 and parent_cluster_id >= 0:
            parents_map[(level, cid)] = (parent_level, parent_cluster_id)

    levels = sorted(levels_set)
    return rows, children_map, parents_map, levels


def load_existing_level3_labels() -> Dict[int, Dict[str, Dict[str, str]]]:
    """
    Load existing level-3 labels from public/cluster_labels.json.

    In the current format, levels["0"] is treated as hierarchy level=3.
    Returns: cluster_id(int) -> models(dict)
    """
    if not os.path.exists(OLD_LABELS_JSON):
        raise FileNotFoundError(f"cluster_labels.json not found: {OLD_LABELS_JSON}")
    with open(OLD_LABELS_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    levels = data.get("levels", {})

    # 现有文件中只有 "0" 这一层，把它视作 hierarchy level=3 的 labels
    level0 = levels.get("0", {})
    level3_labels: Dict[int, Dict[str, Dict[str, str]]] = {}
    for k, v in level0.items():
        try:
            cid = int(k)
        except Exception:
            continue
        models = v.get("models", {})
        if isinstance(models, dict):
            level3_labels[cid] = models
    return level3_labels


def collect_level3_descendants(
    children_map: Dict[Tuple[int, int], List[Tuple[int, int]]],
    level: int,
    cid: int,
) -> List[int]:
    """
    Starting from arbitrary (level, cid), recursively collect all cluster_id where level == 3.
    """
    result: Set[int] = set()

    def dfs(lv: int, node_id: int) -> None:
        if lv == 3:
            result.add(node_id)
            return
        for (next_lv, child_id) in children_map.get((lv, node_id), []):
            # 只向更深的一层走，防止意外循环
            if next_lv <= lv:
                continue
            dfs(next_lv, child_id)

    dfs(level, cid)
    return sorted(result)


def make_meta_models_for_upper_level(
    level: int,
    cid: int,
    level3_ids: List[int],
    level3_labels: Dict[int, Dict[str, Dict[str, str]]],
) -> Dict[str, Dict[str, str]]:
    """
    Generate aggregated MedGemma/BioMistral descriptions for nodes with level < 3.
    """
    child_titles: List[str] = []
    for c3 in level3_ids:
        models = level3_labels.get(c3, {})
        mg = models.get("MedGemma") or {}
        t = str(mg.get("title", "")).strip()
        if t:
            child_titles.append(f"{c3}: {t}")

    child_titles_sorted = ", ".join(child_titles) if child_titles else "multiple level-3 clusters"

    med_title = f"Meta-cluster L{level}C{cid}"
    med_desc = (
        f"This high-level cluster (level {level}, id {cid}) aggregates multiple level-3 clusters "
        f"({child_titles_sorted}). It summarizes a broader mixture of phenotypes and should be used "
        f"for coarse semantic zoom and global tissue structure overview rather than detailed cell-type interpretation."
    )
    bio_title = f"Coarse phenotypic group L{level}C{cid}"
    bio_desc = (
        "High-level meta-cluster summarizing combined imaging-derived phenotypes from its child clusters. "
        "Use deeper levels (e.g. level 3 or 4) for more specific biological interpretation and marker patterns."
    )

    return {
        "MedGemma": {"title": med_title, "description": med_desc},
        "BioMistral": {"title": bio_title, "description": bio_desc},
    }


def make_subcluster_models_for_level4(
    level4_key: Tuple[int, int],
    parent_key: Tuple[int, int],
    level3_labels: Dict[int, Dict[str, Dict[str, str]]],
) -> Dict[str, Dict[str, str]]:
    """
    Level-4 subclusters: reuse the parent level-3 text and add a \"subcluster\" explanation.
    """
    _, cid = level4_key
    parent_level, parent_cid = parent_key

    parent_models = level3_labels.get(parent_cid, {})
    mg_parent = parent_models.get("MedGemma") or {}
    bio_parent = parent_models.get("BioMistral") or {}

    parent_title = str(mg_parent.get("title", "Parent cluster")).strip()
    parent_desc = str(mg_parent.get("description", "")).strip()

    med_title = f"{parent_title} – subcluster {cid} (level 4)"
    med_desc = (
        f"This subcluster (level 4, id {cid}) refines the parent level-3 cluster '{parent_title}' "
        f"(parent level {parent_level}, id {parent_cid}). "
        f"It represents a more spatially or phenotypically focused subset of that population.\n\n"
        f"Parent description:\n{parent_desc}"
    )

    bio_title = f"Refined subcluster {cid} of level-3 cluster {parent_cid}"
    bio_desc = (
        "Fine-grained subcluster derived from a parent level-3 phenotype. "
        "It likely captures local variations in marker intensity, spatial context, or activation state "
        "within the broader parent population."
    )

    return {
        "MedGemma": {"title": med_title, "description": med_desc},
        "BioMistral": {"title": bio_title, "description": bio_desc},
    }


def main() -> None:
    # 1. Load hierarchy information
    _, children_map, parents_map, hierarchy_levels = load_hierarchy()
    # 2. Load existing level-3 texts (from cluster_labels.json levels["0"])
    level3_labels = load_existing_level3_labels()

    # 3. Build new levels: keys "0".."4", aligned with cluster_L0..L4 in data.csv
    out_levels: Dict[str, Dict[str, Dict[str, object]]] = {}

    for lv in hierarchy_levels:
        lv = int(lv)
        out_levels[str(lv)] = {}

    for (lv, cid_children) in children_map.keys():
        # Ensure all nodes are initialized, even if a node has no children
        out_levels.setdefault(str(lv), {})
        out_levels[str(lv)].setdefault(str(cid_children), {"models": {}})

    # Also include finest-level nodes (e.g. level=4) that have no children
    for (lv, cid) in parents_map.keys():
        out_levels.setdefault(str(lv), {})
        out_levels[str(lv)].setdefault(str(cid), {"models": {}})

    # Then fill in models for each node according to its level
    for lv in hierarchy_levels:
        lv = int(lv)
        for cid_str in list(out_levels.get(str(lv), {}).keys()):
            cid = int(cid_str)

            if lv == 3:
                # Directly use level-3 text from the old JSON
                models = level3_labels.get(cid)
                if not models:
                    # Defensive fallback: if missing in old JSON, create a placeholder
                    models = {
                        "MedGemma": {
                            "title": f"Cluster {cid} (level 3)",
                            "description": (
                                "Cluster label placeholder: original level-3 label not found in the old JSON. "
                                "Please regenerate with the LLM pipeline if more detail is needed."
                            ),
                        },
                        "BioMistral": {
                            "title": f"Phenotype cluster {cid}",
                            "description": (
                                "This cluster represents a coherent phenotypic population at hierarchy level 3."
                            ),
                        },
                    }
                out_levels[str(lv)][cid_str] = {"models": models}

            elif lv < 3:
                # Upper levels: aggregate based on child level-3 clusters
                level3_ids = collect_level3_descendants(children_map, lv, cid)
                models = make_meta_models_for_upper_level(lv, cid, level3_ids, level3_labels)
                out_levels[str(lv)][cid_str] = {"models": models}

            else:  # lv > 3，例如 level=4
                # Deeper levels, e.g. level=4
                parent = parents_map.get((lv, cid))
                if parent is None or parent[0] != 3:
                    # In theory this should not happen; keep a defensive fallback
                    models = {
                        "MedGemma": {
                            "title": f"Cluster {cid} (level {lv})",
                            "description": (
                                "Fine-grained subcluster at a deep hierarchy level. "
                                "Parent cluster metadata could not be resolved from the hierarchy file."
                            ),
                        },
                        "BioMistral": {
                            "title": f"Fine subcluster {cid}",
                            "description": (
                                "Subcluster at the finest hierarchy level. "
                                "Consider examining marker-level statistics for detailed interpretation."
                            ),
                        },
                    }
                else:
                    models = make_subcluster_models_for_level4((lv, cid), parent, level3_labels)
                out_levels[str(lv)][cid_str] = {"models": models}

    out_data = {"levels": out_levels}
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)

    print(f"Written multi-level labels to: {OUT_JSON}")
    print("After verifying the result, you can rename this file to public/cluster_labels.json to overwrite the original.")


if __name__ == "__main__":
    main()




