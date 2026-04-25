export const RENDER_SPRITES = "sprites";
export const RENDER_POINTS = "points";

/**
 * 单细胞聚焦（眼睛 __focusCell*、点击拉近）的 deck zoom。
 * Spatial 为世界像素坐标（数千量级），与 UMAP 归一化坐标不能共用同一 zoom，否则 spatial 会放得极大、UMAP 偏小。
 */
export const CELL_FOCUS_ZOOM_SPATIAL = 2.25;
export const CELL_FOCUS_ZOOM_UMAP = 14;

/** Spatial：滚轮缩放略柔（原 ~0.8 偏猛） */
export const SPATIAL_SCROLL_ZOOM_SPEED = 0.5;
/** UMAP：滚轮缩放略强（默认 ~0.01 太弱） */
export const UMAP_SCROLL_ZOOM_SPEED = 0.038;

/** OME 首帧 fit 在 log2(zoom) 上减去该值，略缩小默认视野 */
export const OME_AUTO_FIT_ZOOM_SUB = 0.28;

/**
 * OME spatial 的 marker/方框：固定等价于 UMAP 在此滑条值时的尺寸（与 umapMatched 同一套 clamp），不随 Size Control 变化。
 */
export const OME_SPATIAL_IMAGE_SIZE_FIXED = 0.3;
