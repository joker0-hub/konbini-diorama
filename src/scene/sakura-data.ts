import * as THREE from 'three';

export interface BranchDef {
  pts: THREE.Vector3[];
  rStart: number;
  rEnd: number;
  radSeg: number;
  tubSeg: number;
}

export interface CanopyCloud {
  pos: [number, number, number];
  rx: number;
  ry: number;
  rz: number;
  density: number;
  role: string;
}

export const MAIN_BRANCH_DEFS: BranchDef[] = [
                // 1. 主树干并直达左上主冠核心
                {
                    pts: [
                        new THREE.Vector3(0, 0.0, 0),
                        new THREE.Vector3(-0.04, 0.9, 0.02),
                        new THREE.Vector3(-0.10, 1.75, 0.0),
                        new THREE.Vector3(-0.18, 2.45, -0.04),
                        new THREE.Vector3(-0.42, 3.35, -0.15),
                        new THREE.Vector3(-0.68, 4.35, -0.22),
                        new THREE.Vector3(-0.85, 5.25, -0.05),
                        new THREE.Vector3(-0.95, 5.95, 0.12)
                    ],
                    rStart: 0.31, rEnd: 0.045, radSeg: 14, tubSeg: 32
                },
                // 2. 右侧主大枝（从 2.15m 分出，向右上及便利店招牌方向延展）
                {
                    pts: [
                        new THREE.Vector3(-0.14, 2.15, -0.02),
                        new THREE.Vector3(0.25, 2.75, 0.06),
                        new THREE.Vector3(0.75, 3.35, 0.18),
                        new THREE.Vector3(1.38, 3.85, 0.32),
                        new THREE.Vector3(2.05, 4.15, 0.42),
                        new THREE.Vector3(2.65, 4.05, 0.52)
                    ],
                    rStart: 0.19, rEnd: 0.03, radSeg: 10, tubSeg: 24
                },
                // 3. 中央偏右高耸主枝（支撑起树冠最高峰与右上后方饱满树冠）
                {
                    pts: [
                        new THREE.Vector3(-0.16, 2.40, -0.04),
                        new THREE.Vector3(0.08, 3.25, -0.18),
                        new THREE.Vector3(0.28, 4.25, -0.35),
                        new THREE.Vector3(0.45, 5.25, -0.28),
                        new THREE.Vector3(0.55, 6.15, -0.12),
                        new THREE.Vector3(0.38, 6.72, 0.05)
                    ],
                    rStart: 0.18, rEnd: 0.03, radSeg: 10, tubSeg: 24
                },
                // 4. 左侧大幅伸展的主横枝（还原原图左侧蓬松外探的云朵状花团）
                {
                    pts: [
                        new THREE.Vector3(-0.22, 2.55, -0.02),
                        new THREE.Vector3(-0.72, 3.05, 0.12),
                        new THREE.Vector3(-1.35, 3.50, 0.25),
                        new THREE.Vector3(-2.05, 3.82, 0.32),
                        new THREE.Vector3(-2.72, 3.78, 0.38)
                    ],
                    rStart: 0.16, rEnd: 0.028, radSeg: 10, tubSeg: 22
                },
                // 5. 左下方标志性的低垂侧枝（原图中树干中下部向左侧探出的两簇低矮樱花）
                {
                    pts: [
                        new THREE.Vector3(-0.12, 1.92, 0.04),
                        new THREE.Vector3(-0.48, 2.28, 0.36),
                        new THREE.Vector3(-0.92, 2.48, 0.68),
                        new THREE.Vector3(-1.38, 2.38, 0.88)
                    ],
                    rStart: 0.10, rEnd: 0.022, radSeg: 8, tubSeg: 16
                },
                // 6. 右下方低矮前探侧枝（原图中分叉处向右下方探出的一簇樱花）
                {
                    pts: [
                        new THREE.Vector3(0.12, 2.48, 0.06),
                        new THREE.Vector3(0.58, 2.65, 0.48),
                        new THREE.Vector3(1.05, 2.58, 0.85)
                    ],
                    rStart: 0.09, rEnd: 0.02, radSeg: 8, tubSeg: 14
                },
                // 7. 【新增纵深】正前方高挑外探大枝（让侧面观察时前胸饱满凸出，但高抬不遮挡下部主干分叉）
                {
                    pts: [
                        new THREE.Vector3(-0.15, 2.65, 0.05),
                        new THREE.Vector3(-0.10, 3.35, 0.72),
                        new THREE.Vector3(-0.22, 4.05, 1.48),
                        new THREE.Vector3(-0.38, 4.45, 2.15),
                        new THREE.Vector3(-0.45, 4.32, 2.55)
                    ],
                    rStart: 0.15, rEnd: 0.025, radSeg: 9, tubSeg: 20
                },
                // 8. 【新增纵深】右前方斜伸主枝（撑起侧面与右前45度角的丰满体积）
                {
                    pts: [
                        new THREE.Vector3(0.18, 2.85, 0.08),
                        new THREE.Vector3(0.55, 3.45, 0.75),
                        new THREE.Vector3(0.95, 3.92, 1.42),
                        new THREE.Vector3(1.28, 4.08, 1.98)
                    ],
                    rStart: 0.13, rEnd: 0.024, radSeg: 8, tubSeg: 18
                },
                // 9. 【新增纵深】左前方上扬副主枝（填补左前侧球面体积）
                {
                    pts: [
                        new THREE.Vector3(-0.45, 3.25, 0.08),
                        new THREE.Vector3(-0.92, 3.85, 0.78),
                        new THREE.Vector3(-1.35, 4.42, 1.45),
                        new THREE.Vector3(-1.62, 4.65, 1.92)
                    ],
                    rStart: 0.13, rEnd: 0.024, radSeg: 8, tubSeg: 18
                },
                // 10. 【新增纵深】正后方深远主大枝（大幅向 -Z 延伸至 -2.65m，彻底解决侧面看后背扁平的问题）
                {
                    pts: [
                        new THREE.Vector3(-0.15, 2.38, -0.06),
                        new THREE.Vector3(-0.18, 3.05, -0.78),
                        new THREE.Vector3(-0.25, 3.68, -1.55),
                        new THREE.Vector3(-0.32, 4.12, -2.22),
                        new THREE.Vector3(-0.28, 4.02, -2.68)
                    ],
                    rStart: 0.17, rEnd: 0.028, radSeg: 10, tubSeg: 22
                },
                // 11. 【新增纵深】左后方深展主枝（撑起左后侧庞大冠幅）
                {
                    pts: [
                        new THREE.Vector3(-0.38, 3.15, -0.12),
                        new THREE.Vector3(-0.88, 3.72, -0.82),
                        new THREE.Vector3(-1.42, 4.25, -1.52),
                        new THREE.Vector3(-1.85, 4.48, -2.08)
                    ],
                    rStart: 0.14, rEnd: 0.025, radSeg: 9, tubSeg: 18
                },
                // 12. 【新增纵深】右后方高挑主枝（撑起右后侧与顶部后方冠幅）
                {
                    pts: [
                        new THREE.Vector3(0.15, 3.05, -0.10),
                        new THREE.Vector3(0.65, 3.68, -0.78),
                        new THREE.Vector3(1.18, 4.35, -1.45),
                        new THREE.Vector3(1.55, 4.78, -2.02)
                    ],
                    rStart: 0.14, rEnd: 0.025, radSeg: 9, tubSeg: 18
                },
                // 13. 【新增纵深】后上方穹顶支脉（让侧面看树顶呈饱满圆拱形而非薄片）
                {
                    pts: [
                        new THREE.Vector3(-0.25, 4.15, -0.25),
                        new THREE.Vector3(-0.15, 4.95, -0.92),
                        new THREE.Vector3(-0.05, 5.65, -1.55),
                        new THREE.Vector3(0.05, 5.98, -2.05)
                    ],
                    rStart: 0.13, rEnd: 0.024, radSeg: 8, tubSeg: 16
                }];

export const CANOPY_CLOUD_CENTERS: CanopyCloud[] = [
                // --- 1. 左下低垂花簇 (原图树干左侧下方标志性的粉红垂枝花团) ---
                { pos: [-1.28, 2.35, 0.78], rx: 0.68, ry: 0.48, rz: 0.68, density: 360, role: 'side' },
                { pos: [-0.75, 2.52, 0.52], rx: 0.52, ry: 0.38, rz: 0.52, density: 210, role: 'frontWindow' },
                { pos: [-1.62, 2.68, 0.35], rx: 0.65, ry: 0.46, rz: 0.65, density: 320, role: 'side' },

                // --- 2. 右下低垂小花簇 (原图分叉右侧偏下花团) ---
                { pos: [1.05, 2.56, 0.78], rx: 0.60, ry: 0.44, rz: 0.62, density: 290, role: 'side' },
                { pos: [0.58, 2.72, 0.45], rx: 0.46, ry: 0.35, rz: 0.48, density: 160, role: 'frontWindow' },

                // --- 3. 左侧中层宽阔外展花簇 (原图最左边伸出画面的蓬松花枝 + 前后纵深延展) ---
                { pos: [-2.72, 3.78, 0.35], rx: 0.82, ry: 0.60, rz: 0.82, density: 520, role: 'side' },
                { pos: [-2.12, 3.62, 0.58], rx: 0.85, ry: 0.62, rz: 0.85, density: 540, role: 'side' },
                { pos: [-1.52, 3.45, 0.38], rx: 0.76, ry: 0.56, rz: 0.76, density: 420, role: 'frontWindow' },
                { pos: [-2.28, 4.28, -0.25], rx: 0.82, ry: 0.60, rz: 0.82, density: 510, role: 'side' },
                { pos: [-1.85, 3.95, -0.95], rx: 0.88, ry: 0.65, rz: 0.88, density: 540, role: 'deep' },

                // --- 4. 右侧向便利店招牌延伸的花枝团簇 (原图右侧伸向 ホシノマート 招牌的樱花) ---
                { pos: [1.65, 3.85, 0.38], rx: 0.85, ry: 0.62, rz: 0.82, density: 540, role: 'side' },
                { pos: [2.38, 4.02, 0.45], rx: 0.82, ry: 0.58, rz: 0.78, density: 510, role: 'side' },
                { pos: [2.85, 3.88, 0.35], rx: 0.65, ry: 0.48, rz: 0.65, density: 360, role: 'side' },
                { pos: [1.95, 4.45, -0.25], rx: 0.80, ry: 0.58, rz: 0.80, density: 480, role: 'side' },

                // --- 5. 正面中层透枝区 (刻意留出呼吸感空隙，让主干分叉与内层枝条若隐若现) ---
                { pos: [-0.88, 3.72, 0.68], rx: 0.72, ry: 0.52, rz: 0.72, density: 310, role: 'frontWindow' },
                { pos: [0.85, 3.65, 0.65], rx: 0.72, ry: 0.52, rz: 0.72, density: 310, role: 'frontWindow' },
                { pos: [-0.05, 4.15, 0.75], rx: 0.75, ry: 0.55, rz: 0.75, density: 320, role: 'frontWindow' },

                // --- 6. 【关键新增】前胸远端立体外探花团 (+Z 方向 1.3m ~ 2.6m，让侧面看前半球饱满浑圆) ---
                { pos: [-0.38, 4.35, 2.25], rx: 0.88, ry: 0.64, rz: 0.88, density: 520, role: 'frontDeep' },
                { pos: [-0.45, 4.18, 2.65], rx: 0.68, ry: 0.50, rz: 0.72, density: 360, role: 'frontDeep' },
                { pos: [1.18, 4.02, 1.88], rx: 0.85, ry: 0.62, rz: 0.85, density: 490, role: 'frontDeep' },
                { pos: [0.55, 3.55, 1.52], rx: 0.78, ry: 0.56, rz: 0.78, density: 380, role: 'frontWindow' },
                { pos: [-1.45, 4.52, 1.78], rx: 0.86, ry: 0.64, rz: 0.86, density: 510, role: 'frontDeep' },
                { pos: [-1.05, 3.68, 1.45], rx: 0.78, ry: 0.56, rz: 0.78, density: 390, role: 'frontWindow' },
                { pos: [0.15, 5.15, 1.65], rx: 0.88, ry: 0.65, rz: 0.88, density: 520, role: 'frontDeep' },
                { pos: [-0.65, 5.35, 1.35], rx: 0.85, ry: 0.62, rz: 0.85, density: 490, role: 'frontDeep' },

                // --- 7. 中上层与左上层明亮受光花团 ---
                { pos: [-1.55, 4.82, 0.15], rx: 0.92, ry: 0.68, rz: 0.90, density: 620, role: 'crown' },
                { pos: [-0.82, 4.92, 0.25], rx: 0.88, ry: 0.65, rz: 0.86, density: 540, role: 'frontWindow' },
                { pos: [0.12, 4.85, 0.22], rx: 0.86, ry: 0.64, rz: 0.86, density: 520, role: 'frontWindow' },
                { pos: [0.98, 4.88, 0.18], rx: 0.88, ry: 0.65, rz: 0.86, density: 580, role: 'crown' },
                { pos: [1.62, 4.98, -0.15], rx: 0.78, ry: 0.58, rz: 0.78, density: 460, role: 'crown' },

                // --- 8. 树冠顶部云端华盖 (原图最上方受阳光照耀泛着淡粉白高光的树冠顶峰 + 纵深圆顶) ---
                { pos: [-1.15, 5.72, 0.05], rx: 0.90, ry: 0.68, rz: 0.90, density: 640, role: 'crown' },
                { pos: [-0.45, 6.18, 0.08], rx: 0.95, ry: 0.72, rz: 0.95, density: 690, role: 'crown' },
                { pos: [0.35, 6.42, 0.02], rx: 0.90, ry: 0.68, rz: 0.90, density: 640, role: 'crown' },
                { pos: [0.92, 5.88, -0.05], rx: 0.82, ry: 0.62, rz: 0.82, density: 520, role: 'crown' },
                { pos: [-0.05, 6.72, -0.15], rx: 0.75, ry: 0.56, rz: 0.78, density: 450, role: 'crown' },
                { pos: [-0.25, 6.15, 0.95], rx: 0.82, ry: 0.62, rz: 0.82, density: 480, role: 'crown' },

                // --- 9. 【关键新增】后背深远立体花团 (-Z 方向 -0.9m ~ -2.85m，彻底消除侧面扁平感) ---
                { pos: [-0.95, 4.25, -1.15], rx: 0.96, ry: 0.72, rz: 0.96, density: 640, role: 'deep' },
                { pos: [0.35, 4.45, -1.22], rx: 0.96, ry: 0.72, rz: 0.96, density: 640, role: 'deep' },
                { pos: [-0.28, 3.98, -2.25], rx: 0.95, ry: 0.70, rz: 0.95, density: 660, role: 'deep' },
                { pos: [-0.25, 3.85, -2.75], rx: 0.76, ry: 0.56, rz: 0.78, density: 450, role: 'deep' },
                { pos: [-1.68, 4.38, -1.88], rx: 0.92, ry: 0.68, rz: 0.92, density: 610, role: 'deep' },
                { pos: [1.45, 4.65, -1.85], rx: 0.92, ry: 0.68, rz: 0.92, density: 610, role: 'deep' },
                { pos: [-0.15, 5.35, -1.35], rx: 0.94, ry: 0.70, rz: 0.94, density: 630, role: 'deep' },
                { pos: [0.05, 5.88, -1.95], rx: 0.86, ry: 0.65, rz: 0.88, density: 560, role: 'deep' },
                { pos: [-0.85, 5.25, -2.05], rx: 0.84, ry: 0.64, rz: 0.84, density: 520, role: 'deep' },
                { pos: [0.88, 5.32, -1.92], rx: 0.84, ry: 0.64, rz: 0.84, density: 520, role: 'deep' },
                { pos: [-0.35, 3.15, -1.65], rx: 0.82, ry: 0.58, rz: 0.82, density: 460, role: 'deep' }
];
