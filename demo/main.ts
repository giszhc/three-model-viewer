import gsap from 'gsap';
import { Viewer } from '../src/index';
import { CameraView, MeasurementType, ModelLoadResult, ModelDisplayStyle } from '../src/types';

// 1. Initialize Viewer
const viewport = document.getElementById('viewport') as HTMLElement;
const viewer = new Viewer({
  container: viewport,
  background: '#080c16',
  unit: 'm',
  antialias: true,
});

// Elements
const statVerts = document.getElementById('stat-verts') as HTMLElement;
const statFaces = document.getElementById('stat-faces') as HTMLElement;
const statDims = document.getElementById('stat-dims') as HTMLElement;
const toolTip = document.getElementById('tool-tip') as HTMLElement;
const brandModelName = document.getElementById('brand-model-name') as HTMLElement;
const dockBar = document.getElementById('dock-bar') as HTMLElement;
const hudBadge = document.getElementById('hud-badge') as HTMLElement;
const exportMenuWrapper = document.getElementById('export-menu-wrapper') as HTMLElement;
const btnToggleBbox = document.getElementById('btn-toggle-bbox') as HTMLButtonElement;
const sideDrawer = document.getElementById('side-drawer') as HTMLElement;
const btnDockTools = document.getElementById('btn-dock-tools') as HTMLButtonElement;

// Central Upload Zone Elements
const uploadZone = document.getElementById('upload-zone') as HTMLElement;
const zoneFileInput = document.getElementById('zone-file-input') as HTMLInputElement;
const btnBrowseZone = document.getElementById('btn-browse-zone') as HTMLButtonElement;
const btnLoadSample = document.getElementById('btn-load-sample') as HTMLButtonElement;
const btnUnloadModel = document.getElementById('btn-unload-model') as HTMLButtonElement;

// Modern Glassmorphism Loading Modal Elements
const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;
const loadingTitle = document.getElementById('loading-title') as HTMLElement;
const loadingStatus = document.getElementById('loading-status') as HTMLElement;
const loadingBar = document.getElementById('loading-bar') as HTMLElement;
const loadingPercent = document.getElementById('loading-percent') as HTMLElement;

let tipTimer: number | null = null;
function showTip(text: string, duration: number = 2500): void {
  if (tipTimer) clearTimeout(tipTimer);
  toolTip.textContent = text;
  toolTip.style.display = 'flex';
  gsap.killTweensOf(toolTip);
  gsap.fromTo(
    toolTip,
    { y: -18, opacity: 0, scale: 0.92 },
    { y: 0, opacity: 1, scale: 1, duration: 0.38, ease: 'back.out(1.7)' }
  );
  tipTimer = window.setTimeout(() => {
    hideTip();
  }, duration);
}

function hideTip(): void {
  gsap.killTweensOf(toolTip);
  gsap.to(toolTip, {
    y: -12,
    opacity: 0,
    scale: 0.95,
    duration: 0.25,
    ease: 'power2.in',
    onComplete: () => {
      toolTip.style.display = 'none';
    },
  });
}

// Update model stats
function updateStats(result: ModelLoadResult): void {
  statVerts.textContent = result.vertexCount.toLocaleString();
  statFaces.textContent = result.faceCount.toLocaleString();
  statDims.textContent = `${result.size.x.toFixed(2)}m × ${result.size.y.toFixed(2)}m × ${result.size.z.toFixed(2)}m`;
}

/**
 * Centrally toggle UI presence: hide all tools, bounding box controls, dock, stats, and drawer when no model is loaded.
 * Enhanced with silky-smooth GSAP physics spring transitions.
 */
function updateModelPresenceUI(hasModel: boolean, modelName?: string): void {
  if (hasModel) {
    // Crossfade upload zone out
    gsap.to(uploadZone, {
      opacity: 0,
      scale: 0.98,
      duration: 0.35,
      ease: 'power2.inOut',
      onComplete: () => {
        uploadZone?.classList.add('hidden');
        gsap.set(uploadZone, { clearProps: 'all' });
      },
    });

    dockBar?.classList.remove('hidden');
    hudBadge?.classList.remove('hidden');
    exportMenuWrapper?.classList.remove('hidden');
    if (btnUnloadModel) btnUnloadModel.style.display = 'inline-flex';
    if (brandModelName) {
      brandModelName.style.display = 'inline-block';
      if (modelName) brandModelName.textContent = modelName;
    }

    // Liquid spring entrance
    gsap.killTweensOf([dockBar, hudBadge, exportMenuWrapper, btnUnloadModel]);
    gsap.fromTo(
      dockBar,
      { y: 36, opacity: 0, scale: 0.94 },
      { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.4)', clearProps: 'transform,scale' }
    );

    gsap.fromTo(
      hudBadge,
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.45, delay: 0.08, ease: 'power3.out', clearProps: 'transform' }
    );

    gsap.fromTo(
      exportMenuWrapper,
      { y: -10, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.35, delay: 0.12, ease: 'power2.out', clearProps: 'transform' }
    );

    if (btnUnloadModel) {
      gsap.fromTo(
        btnUnloadModel,
        { scale: 0.8, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.35, delay: 0.16, ease: 'back.out(2)', clearProps: 'transform,scale' }
      );
    }
  } else {
    // Exit animations with smooth retraction
    gsap.killTweensOf([dockBar, hudBadge, exportMenuWrapper, btnUnloadModel]);
    gsap.to(dockBar, {
      y: 32,
      opacity: 0,
      scale: 0.95,
      duration: 0.3,
      ease: 'power2.in',
      onComplete: () => {
        dockBar?.classList.add('hidden');
        gsap.set(dockBar, { clearProps: 'all' });
      },
    });

    gsap.to(hudBadge, {
      y: 18,
      opacity: 0,
      duration: 0.25,
      ease: 'power2.in',
      onComplete: () => {
        hudBadge?.classList.add('hidden');
        gsap.set(hudBadge, { clearProps: 'all' });
      },
    });

    gsap.to(exportMenuWrapper, {
      y: -8,
      opacity: 0,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: () => {
        exportMenuWrapper?.classList.add('hidden');
        gsap.set(exportMenuWrapper, { clearProps: 'all' });
      },
    });

    if (btnUnloadModel) btnUnloadModel.style.display = 'none';
    if (brandModelName) {
      brandModelName.style.display = 'none';
      brandModelName.textContent = '';
    }

    // Bring upload zone back smoothly
    uploadZone?.classList.remove('hidden');
    gsap.fromTo(
      uploadZone,
      { opacity: 0, scale: 0.98 },
      { opacity: 1, scale: 1, duration: 0.4, ease: 'power2.out', clearProps: 'all' }
    );

    // Close side drawer & active popovers
    animateDrawerClose();
    closeAllPopovers();

    // Reset stats & tools
    statVerts.textContent = '-';
    statFaces.textContent = '-';
    statDims.textContent = '-';
    btnToggleBbox?.classList.remove('active');
  }
}

// Loading Progress Events
viewer.on('load:start', (source) => {
  loadingOverlay.classList.add('active');
  const name = typeof source === 'string' ? source.split('/').pop() || source : '三维模型';
  loadingTitle.textContent = `正在载入: ${name}`;
  loadingStatus.textContent = '准备解析资源数据...';
  loadingBar.style.width = '8%';
  loadingPercent.textContent = '8%';
  if (brandModelName) brandModelName.textContent = name;
});

viewer.on('load:progress', (percent, message) => {
  loadingBar.style.width = `${percent}%`;
  loadingPercent.textContent = `${percent}%`;
  loadingStatus.textContent = message;
});

viewer.on('load:success', (res) => {
  loadingBar.style.width = '100%';
  loadingPercent.textContent = '100%';
  loadingStatus.textContent = '加载成功！';
  updateStats(res);
  const currentName = brandModelName?.textContent || '三维模型';
  updateModelPresenceUI(true, currentName);
  btnToggleBbox?.classList.toggle('active', viewer.getBoundingBoxVisible());
  setTimeout(() => {
    loadingOverlay.classList.remove('active');
  }, 400);
});

viewer.on('load:error', (err) => {
  loadingStatus.textContent = `❌ 加载失败: ${err.message}`;
  setTimeout(() => {
    loadingOverlay.classList.remove('active');
  }, 3500);
  if (!viewer.currentModelInfo) {
    updateModelPresenceUI(false);
  }
});

// Initial presence state: Ensure all tools & box controls are hidden if no model is loaded
if (viewer.currentModelInfo) {
  updateStats(viewer.currentModelInfo);
  updateModelPresenceUI(true);
} else {
  updateModelPresenceUI(false);
}

// ==========================================
// Central Upload Area Events
// ==========================================
btnBrowseZone?.addEventListener('click', (e) => {
  e.stopPropagation();
  zoneFileInput?.click();
});

btnLoadSample?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (brandModelName) brandModelName.textContent = '工业装配体 (示例)';
  showTip('🚀 正在初始化工业示例模型...');
  viewer.loadSampleGeometry('mechanical');
  showTip('✅ 示例模型载入完成，已就绪！');
  setTimeout(hideTip, 2500);
});

uploadZone?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (target.classList.contains('hint-link') || target.closest('#btn-load-sample')) return;
  zoneFileInput?.click();
});

zoneFileInput?.addEventListener('change', async (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    await handleLoadedFiles(target.files);
  }
});

uploadZone?.addEventListener('dragenter', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone?.addEventListener('dragleave', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
});

uploadZone?.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  uploadZone.classList.remove('dragover');
  dropOverlay.style.display = 'none';

  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    await handleLoadedFiles(e.dataTransfer.files);
  }
});

// Unload Model Button
btnUnloadModel?.addEventListener('click', () => {
  viewer.clearModel();
  viewer.setSectioningEnabled(false);
  updateSectioningUI();
  updateModelPresenceUI(false);
  showTip('已卸载模型，请上传或选择新模型');
  setTimeout(hideTip, 2500);
});

// ==========================================
// File Input & Drag and Drop (ZIP / OBJ)
// ==========================================
async function handleLoadedFiles(fileList: FileList | File[]): Promise<void> {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  const zipFile = files.find((f) => f.name.toLowerCase().endsWith('.zip'));
  const objFile = files.find((f) => f.name.toLowerCase().endsWith('.obj'));
  const mtlFile = files.find((f) => f.name.toLowerCase().endsWith('.mtl'));

  try {
    if (zipFile) {
      if (brandModelName) brandModelName.textContent = zipFile.name;
      showTip(`正在解压并加载 ${zipFile.name}...`);
      await viewer.loadZip(zipFile);
      showTip(`✅ 成功加载 ZIP 模型: ${zipFile.name}`);
    } else if (objFile) {
      if (brandModelName) brandModelName.textContent = objFile.name;
      showTip(`正在加载 ${objFile.name}...`);
      const objUrl = URL.createObjectURL(objFile);
      const mtlUrl = mtlFile ? URL.createObjectURL(mtlFile) : undefined;
      await viewer.loadOBJ(objUrl, mtlUrl);
      showTip(`✅ 成功加载 OBJ 模型: ${objFile.name}`);
    } else {
      showTip('⚠️ 请选择 .zip 压缩包或 .obj 模型文件');
      setTimeout(hideTip, 3000);
      return;
    }
    setTimeout(hideTip, 3000);
  } catch (err) {
    showTip(`❌ 加载失败: ${(err as Error).message}`);
    setTimeout(hideTip, 5000);
  }
}

const fileInput = document.getElementById('file-input') as HTMLInputElement;
fileInput?.addEventListener('change', async (e) => {
  const target = e.target as HTMLInputElement;
  if (target.files) {
    await handleLoadedFiles(target.files);
  }
});

// Drag and drop handling
const dropOverlay = document.getElementById('drop-overlay') as HTMLElement;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dropOverlay.style.display = 'flex';
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) {
    dropOverlay.style.display = 'none';
  }
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlay.style.display = 'none';

  if (e.dataTransfer?.files) {
    await handleLoadedFiles(e.dataTransfer.files);
  }
});

// ==========================================
// Theme Switcher (Dark / Light Skin)
// ==========================================
const btnToggleTheme = document.getElementById('btn-toggle-theme') as HTMLButtonElement;
const themeIconSun = document.getElementById('theme-icon-sun') as HTMLElement;
const themeIconMoon = document.getElementById('theme-icon-moon') as HTMLElement;

let currentTheme: 'dark' | 'light' = 'dark';

btnToggleTheme?.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);

  if (currentTheme === 'light') {
    themeIconSun.style.display = 'block';
    themeIconMoon.style.display = 'none';
    viewer.setBackground('#f1f5f9');
    showTip('☀️ 已切换为极简亮色主题');
  } else {
    themeIconSun.style.display = 'none';
    themeIconMoon.style.display = 'block';
    viewer.setBackground('#181c24');
    showTip('🌙 已切换为深邃暗色主题');
  }
  setTimeout(hideTip, 2000);
});

// ==========================================
// Fullscreen Toggle
// ==========================================
document.getElementById('btn-toggle-fullscreen')?.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
});

// ==========================================
// Popover Menus Manager (Dock & Top Menus with GSAP)
// ==========================================
const popoverViews = document.getElementById('popover-views') as HTMLElement;
const popoverAutorotate = document.getElementById('popover-autorotate') as HTMLElement;
const popoverAppearance = document.getElementById('popover-appearance') as HTMLElement;
const popoverExport = document.getElementById('popover-export') as HTMLElement;

const allPopovers = [popoverViews, popoverAutorotate, popoverAppearance, popoverExport];

function openPopover(popover: HTMLElement): void {
  popover.classList.add('open');
  const isTop = popover.classList.contains('popover-menu-top');
  gsap.killTweensOf(popover);
  gsap.fromTo(
    popover,
    {
      opacity: 0,
      scale: 0.93,
      y: isTop ? -14 : 16,
    },
    {
      opacity: 1,
      scale: 1,
      y: 0,
      duration: 0.36,
      ease: 'back.out(1.5)',
      clearProps: 'transform,scale',
    }
  );
}

function closePopover(popover: HTMLElement): void {
  if (!popover.classList.contains('open')) return;
  const isTop = popover.classList.contains('popover-menu-top');
  gsap.killTweensOf(popover);
  gsap.to(popover, {
    opacity: 0,
    scale: 0.95,
    y: isTop ? -8 : 10,
    duration: 0.2,
    ease: 'power2.in',
    onComplete: () => {
      popover.classList.remove('open');
      gsap.set(popover, { clearProps: 'all' });
    },
  });
}

function togglePopover(targetPopover: HTMLElement): void {
  const isOpen = targetPopover.classList.contains('open');
  allPopovers.forEach((p) => {
    if (p && p !== targetPopover && p.classList.contains('open')) {
      closePopover(p);
    }
  });

  if (isOpen) {
    closePopover(targetPopover);
  } else {
    openPopover(targetPopover);
  }
}

function closeAllPopovers(): void {
  allPopovers.forEach((p) => {
    if (p && p.classList.contains('open')) {
      closePopover(p);
    }
  });
}

document.getElementById('btn-dock-views')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePopover(popoverViews);
});

document.getElementById('btn-dock-autorotate')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePopover(popoverAutorotate);
});

document.getElementById('btn-dock-appearance')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePopover(popoverAppearance);
});

document.getElementById('btn-export-menu-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePopover(popoverExport);
});

// Close popovers on clicking outside
document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('.popover-menu') && !target.closest('.dock-btn') && !target.closest('#btn-export-menu-toggle')) {
    closeAllPopovers();
  }
});

// ==========================================
// Side Drawer (Toolbox: Measure & Sectioning with GSAP)
// ==========================================
const btnDrawerClose = document.getElementById('btn-drawer-close') as HTMLButtonElement;
const tabMeasureBtn = document.getElementById('tab-measure-btn') as HTMLButtonElement;
const tabClipBtn = document.getElementById('tab-clip-btn') as HTMLButtonElement;
const drawerPanelMeasure = document.getElementById('drawer-panel-measure') as HTMLElement;
const drawerPanelClip = document.getElementById('drawer-panel-clip') as HTMLElement;

function animateDrawerOpen(): void {
  sideDrawer.classList.add('open');
  btnDockTools.classList.add('active');
  gsap.killTweensOf(sideDrawer);
  gsap.fromTo(
    sideDrawer,
    { x: 45, opacity: 0, scale: 0.98 },
    { x: 0, opacity: 1, scale: 1, duration: 0.42, ease: 'power3.out', clearProps: 'transform,scale' }
  );
}

function animateDrawerClose(): void {
  if (!sideDrawer.classList.contains('open')) return;
  btnDockTools.classList.remove('active');
  gsap.killTweensOf(sideDrawer);
  gsap.to(sideDrawer, {
    x: 35,
    opacity: 0,
    scale: 0.98,
    duration: 0.26,
    ease: 'power2.in',
    onComplete: () => {
      sideDrawer.classList.remove('open');
      gsap.set(sideDrawer, { clearProps: 'all' });
    },
  });
}

btnDockTools?.addEventListener('click', () => {
  const isOpen = sideDrawer.classList.contains('open');
  if (isOpen) {
    animateDrawerClose();
  } else {
    animateDrawerOpen();
    closeAllPopovers();
  }
});

btnDrawerClose?.addEventListener('click', () => {
  animateDrawerClose();
});

// Subtle liquid micro-bounce interaction on clicking buttons
document.querySelectorAll<HTMLButtonElement>('.dock-btn, .btn').forEach((btn) => {
  btn.addEventListener('pointerdown', () => {
    gsap.to(btn, { scale: 0.94, duration: 0.12, ease: 'power1.out' });
  });
  btn.addEventListener('pointerup', () => {
    gsap.to(btn, { scale: 1, duration: 0.32, ease: 'back.out(2)' });
  });
  btn.addEventListener('pointerleave', () => {
    gsap.to(btn, { scale: 1, duration: 0.22, ease: 'power2.out' });
  });
});

tabMeasureBtn?.addEventListener('click', () => {
  tabMeasureBtn.classList.add('active');
  tabClipBtn.classList.remove('active');
  drawerPanelMeasure.style.display = 'flex';
  drawerPanelClip.style.display = 'none';
});

tabClipBtn?.addEventListener('click', () => {
  tabClipBtn.classList.add('active');
  tabMeasureBtn.classList.remove('active');
  drawerPanelClip.style.display = 'flex';
  drawerPanelMeasure.style.display = 'none';
});

// ==========================================
// 8-View Switching
// ==========================================
const viewButtons = document.querySelectorAll<HTMLButtonElement>('[data-view]');
viewButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view') as CameraView;
    if (view) {
      viewer.setView(view, 500);
      popoverViews?.classList.remove('open');
    }
  });
});
document.getElementById('btn-view-fit')?.addEventListener('click', () => {
  viewer.fitView(500);
  showTip('🎯 视角已平滑居中复位');
  setTimeout(hideTip, 1500);
});

// ==========================================
// Auto-Rotation & Axis Locking Controls
// ==========================================
const btnToggleAutoRotate = document.getElementById('btn-toggle-autorotate') as HTMLButtonElement;
const btnRotAxisX = document.getElementById('btn-rot-axis-x') as HTMLButtonElement;
const btnRotAxisY = document.getElementById('btn-rot-axis-y') as HTMLButtonElement;
const btnRotDirCw = document.getElementById('btn-rot-dir-cw') as HTMLButtonElement;
const btnRotDirCcw = document.getElementById('btn-rot-dir-ccw') as HTMLButtonElement;
const dockBtnAutoRotate = document.getElementById('btn-dock-autorotate') as HTMLButtonElement;
const axisLockButtons = document.querySelectorAll<HTMLButtonElement>('#axis-lock-group button');

function updateAutoRotateUI(): void {
  const state = viewer.getAutoRotateState();
  if (btnToggleAutoRotate) {
    if (state.enabled) {
      btnToggleAutoRotate.textContent = '⏸️ 暂停旋转';
      btnToggleAutoRotate.style.background = '#e11d48';
      dockBtnAutoRotate?.classList.add('active');
    } else {
      btnToggleAutoRotate.textContent = '▶️ 开始旋转';
      btnToggleAutoRotate.style.background = 'var(--accent)';
      dockBtnAutoRotate?.classList.remove('active');
    }
  }

  btnRotAxisX?.classList.toggle('active', state.axis === 'x');
  btnRotAxisY?.classList.toggle('active', state.axis === 'y');
  btnRotDirCw?.classList.toggle('active', state.direction === 'clockwise');
  btnRotDirCcw?.classList.toggle('active', state.direction === 'counter-clockwise');
}

btnToggleAutoRotate?.addEventListener('click', () => {
  const isRunning = viewer.toggleAutoRotate();
  updateAutoRotateUI();
  showTip(isRunning ? '🔄 已启动自动旋转 (默认X轴)' : '⏸️ 已暂停自动旋转');
  setTimeout(hideTip, 2000);
});

btnRotAxisX?.addEventListener('click', () => {
  viewer.setAutoRotateAxis('x');
  updateAutoRotateUI();
  showTip('已设定为绕 X 轴旋转 (默认)');
  setTimeout(hideTip, 1500);
});

btnRotAxisY?.addEventListener('click', () => {
  viewer.setAutoRotateAxis('y');
  updateAutoRotateUI();
  showTip('已设定为绕 Y 轴水平旋转');
  setTimeout(hideTip, 1500);
});

btnRotDirCw?.addEventListener('click', () => {
  viewer.setAutoRotateDirection('clockwise');
  updateAutoRotateUI();
  showTip('已设定为 ↻ 顺时针旋转');
  setTimeout(hideTip, 1500);
});

btnRotDirCcw?.addEventListener('click', () => {
  viewer.setAutoRotateDirection('counter-clockwise');
  updateAutoRotateUI();
  showTip('已设定为 ↺ 逆时针旋转');
  setTimeout(hideTip, 1500);
});

axisLockButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const lockVal = btn.getAttribute('data-lock');
    axisLockButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (lockVal === 'x') {
      viewer.setRotationLockedAxis('x');
      showTip('🔒 已锁定 X 轴：俯仰角固定，仅支持绕 Y 轴水平环绕');
    } else if (lockVal === 'y') {
      viewer.setRotationLockedAxis('y');
      showTip('🔒 已锁定 Y 轴：水平方位角固定，仅支持上下俯仰');
    } else if (lockVal === 'z') {
      viewer.setRotationLockedAxis('z');
      showTip('🔒 已锁定 Z 轴：消除滚转侧翻，保持模型垂直正立');
    } else {
      viewer.setRotationLockedAxis(null);
      showTip('🔓 已解除锁定：恢复 360° 全自由度旋转');
    }
    setTimeout(hideTip, 2500);
  });
});

viewer.on('autorotate:change', updateAutoRotateUI);

// ==========================================
// Measurements (Single-Shot Mode: Exits after 1 measurement)
// ==========================================
const measureButtons = [
  document.getElementById('btn-measure-dist') as HTMLButtonElement,
  document.getElementById('btn-measure-height') as HTMLButtonElement,
  document.getElementById('btn-measure-angle') as HTMLButtonElement,
  document.getElementById('btn-measure-area') as HTMLButtonElement,
];

function updateMeasureBtnState(activeMode: MeasurementType): void {
  measureButtons.forEach((btn) => {
    if (btn) {
      const mode = btn.getAttribute('data-mode');
      if (mode === activeMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
}

measureButtons.forEach((btn) => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const mode = btn.getAttribute('data-mode') as MeasurementType;
    if (viewer.getMeasurementMode() === mode) {
      viewer.setMeasurementMode('none');
      updateMeasureBtnState('none');
      hideTip();
    } else {
      viewer.setMeasurementMode(mode);
      updateMeasureBtnState(mode);

      if (mode === 'distance') {
        showTip('📏 距离测量（单次）：在模型表面依次点击两个点');
      } else if (mode === 'height') {
        showTip('📐 高度测量（单次）：在模型表面依次点击两个点');
      } else if (mode === 'angle') {
        showTip('🧭 角度测量（单次）：在模型表面点击第一点、顶点、第二点共 3 点计算夹角');
      } else if (mode === 'area') {
        showTip('🔷 面积测量（单次）：在模型表面点击多边形各顶点，双击结束并计算面积');
      }
    }
  });
});

document.getElementById('btn-measure-undo')?.addEventListener('click', () => {
  viewer.undoMeasurement();
});

document.getElementById('btn-measure-clear')?.addEventListener('click', () => {
  viewer.clearMeasurements();
  viewer.setMeasurementMode('none');
  updateMeasureBtnState('none');
  showTip('已清空全部测量结果');
  setTimeout(hideTip, 2000);
});

viewer.on('measure:complete', (res) => {
  showTip(`✅ 测量完成：${res.formattedValue} (已自动退出测量模式，如需再测请重新点击工具)`);
  updateMeasureBtnState('none');
});

// ==========================================
// Multi-Axis Slicing / Sectioning (Digital3DCloud Standard)
// ==========================================
const switchEnableClip = document.getElementById('switch-enable-clip') as HTMLInputElement;
const clipSettingsBody = document.getElementById('clip-settings-body') as HTMLElement;
const switchHidePlaneHelper = document.getElementById('switch-hide-plane-helper') as HTMLInputElement;

const switchAxisX = document.getElementById('switch-axis-x') as HTMLInputElement;
const switchAxisY = document.getElementById('switch-axis-y') as HTMLInputElement;
const switchAxisZ = document.getElementById('switch-axis-z') as HTMLInputElement;

const axisProgX = document.getElementById('axis-prog-x') as HTMLElement;
const axisProgY = document.getElementById('axis-prog-y') as HTMLElement;
const axisProgZ = document.getElementById('axis-prog-z') as HTMLElement;

const btnInvertX = document.getElementById('btn-invert-x') as HTMLButtonElement;
const btnInvertY = document.getElementById('btn-invert-y') as HTMLButtonElement;
const btnInvertZ = document.getElementById('btn-invert-z') as HTMLButtonElement;

function updateSectioningUI(): void {
  const state = viewer.getSectioningState();

  if (switchEnableClip) {
    switchEnableClip.checked = state.enabled;
  }

  if (clipSettingsBody) {
    clipSettingsBody.style.display = state.enabled ? 'flex' : 'none';
  }

  if (switchHidePlaneHelper) {
    switchHidePlaneHelper.checked = !state.helperVisible;
  }

  const axes = state.axes;
  if (axes) {
    if (switchAxisX && axes.x) {
      switchAxisX.checked = axes.x.enabled;
    }
    if (switchAxisY && axes.y) {
      switchAxisY.checked = axes.y.enabled;
    }
    if (switchAxisZ && axes.z) {
      switchAxisZ.checked = axes.z.enabled;
    }

    if (axisProgX && axes.x) {
      axisProgX.textContent = `${(axes.x.progress * 100).toFixed(0)}%`;
    }
    if (axisProgY && axes.y) {
      axisProgY.textContent = `${(axes.y.progress * 100).toFixed(0)}%`;
    }
    if (axisProgZ && axes.z) {
      axisProgZ.textContent = `${(axes.z.progress * 100).toFixed(0)}%`;
    }

    if (btnInvertX && axes.x) {
      btnInvertX.classList.toggle('inverted', axes.x.inverted);
      btnInvertX.textContent = axes.x.inverted ? '🔄 反向中' : '🔄 反向';
    }
    if (btnInvertY && axes.y) {
      btnInvertY.classList.toggle('inverted', axes.y.inverted);
      btnInvertY.textContent = axes.y.inverted ? '🔄 反向中' : '🔄 反向';
    }
    if (btnInvertZ && axes.z) {
      btnInvertZ.classList.toggle('inverted', axes.z.inverted);
      btnInvertZ.textContent = axes.z.inverted ? '🔄 反向中' : '🔄 反向';
    }
  }
}

switchEnableClip?.addEventListener('change', () => {
  const isEnabled = switchEnableClip.checked;
  viewer.setSectioningEnabled(isEnabled);
  updateSectioningUI();
  if (isEnabled) {
    showTip('🪓 剖切已开启：支持X/Y/Z多轴同时开启裁剪；在3D剖切面上直接拖动即可');
  } else {
    showTip('已关闭剖切');
  }
  setTimeout(hideTip, 2500);
});

switchAxisX?.addEventListener('change', () => {
  viewer.setSectioningAxisEnabled('x', switchAxisX.checked);
  updateSectioningUI();
});

switchAxisY?.addEventListener('change', () => {
  viewer.setSectioningAxisEnabled('y', switchAxisY.checked);
  updateSectioningUI();
});

switchAxisZ?.addEventListener('change', () => {
  viewer.setSectioningAxisEnabled('z', switchAxisZ.checked);
  updateSectioningUI();
});

btnInvertX?.addEventListener('click', () => {
  viewer.invertSectioningAxis('x');
  updateSectioningUI();
});

btnInvertY?.addEventListener('click', () => {
  viewer.invertSectioningAxis('y');
  updateSectioningUI();
});

btnInvertZ?.addEventListener('click', () => {
  viewer.invertSectioningAxis('z');
  updateSectioningUI();
});

switchHidePlaneHelper?.addEventListener('change', () => {
  viewer.setSectioningHelperVisible(!switchHidePlaneHelper.checked);
  updateSectioningUI();
});

const handleResetSectioning = () => {
  viewer.resetSectioning();
  updateSectioningUI();
  showTip('🔄 剖切面已全部重置至中心位置 (50%)');
  setTimeout(hideTip, 2500);
};

document.getElementById('btn-clip-reset')?.addEventListener('click', handleResetSectioning);
document.getElementById('btn-clip-reset-inner')?.addEventListener('click', handleResetSectioning);

viewer.on('sectioning:change', () => {
  updateSectioningUI();
});
viewer.on('clipping:change', () => {
  updateSectioningUI();
});

document.getElementById('btn-clip-custom')?.addEventListener('click', () => {
  updateMeasureBtnState('none');
  viewer.startCustomClip();
  showTip('✏️ 2点划线剖切：请在模型表面点击起点和终点2个点确定切线（模型外禁止点击）');
});

document.getElementById('btn-clip-custom-invert')?.addEventListener('click', () => {
  const success = viewer.invertCustomClip();
  if (success) {
    showTip('🔄 已切换自定义剖切方向（保留另一侧）');
  } else {
    showTip('⚠️ 尚未创建自定义剖切，请先点击“2点划线自定义剖切”');
  }
  setTimeout(hideTip, 2500);
});

// ==========================================
// Bounding Box & Dimensions (L, W, H)
// ==========================================
btnToggleBbox?.addEventListener('click', () => {
  const isVis = viewer.getBoundingBoxVisible();
  viewer.showBoundingBox(!isVis);
  btnToggleBbox.classList.toggle('active', !isVis);
  showTip(!isVis ? '📦 已开启范围框及尺寸线标注' : '已隐藏范围框及尺寸线');
  setTimeout(hideTip, 2000);
});

// ==========================================
// Model Display Style (Solid / Wireframe)
// ==========================================
const displayStyleButtons = document.querySelectorAll<HTMLButtonElement>('#display-style-group button');
const currentStyleBadge = document.getElementById('current-style-badge') as HTMLElement;

function updateDisplayStyleUI(style: ModelDisplayStyle): void {
  displayStyleButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-style') === style);
  });
  if (currentStyleBadge) {
    currentStyleBadge.textContent = style === 'wireframe' ? '网格' : '实体';
  }
}

displayStyleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const style = btn.getAttribute('data-style') as ModelDisplayStyle;
    if (!style) return;
    viewer.setModelDisplayStyle(style);
    updateDisplayStyleUI(style);

    if (style === 'solid') {
      showTip('🧊 已切换为实体表面显示');
    } else if (style === 'wireframe') {
      showTip('🕸️ 已切换为网格线框显示');
    }
    setTimeout(hideTip, 2200);
  });
});

viewer.on('style:change', (style) => {
  updateDisplayStyleUI(style);
});

// ==========================================
// Appearance & Background
// ==========================================
const btnToggleTexture = document.getElementById('btn-toggle-texture') as HTMLButtonElement;
btnToggleTexture?.addEventListener('click', () => {
  const current = viewer.getTextureState();
  viewer.toggleTexture(!current);
  btnToggleTexture.classList.toggle('active', !current);
  showTip(!current ? '🎨 已开启原始纹理贴图' : '🟦 已关闭纹理（显示数模蓝）');
  setTimeout(hideTip, 2200);
});

const btnToggleGrid = document.getElementById('btn-toggle-grid') as HTMLButtonElement;
let gridVis = false;
btnToggleGrid?.addEventListener('click', () => {
  gridVis = !gridVis;
  viewer.setGridVisible(gridVis);
  btnToggleGrid.classList.toggle('active', gridVis);
  showTip(gridVis ? '🏁 已开启地面参考网格' : '已隐藏地面参考网格');
  setTimeout(hideTip, 1800);
});

const bgButtons = document.querySelectorAll<HTMLButtonElement>('[data-bg]');
bgButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    bgButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const bg = btn.getAttribute('data-bg');
    if (bg === 'transparent') {
      viewer.setBackground(null, true);
    } else if (bg) {
      viewer.setBackground(bg, false);
    }
  });
});

// ==========================================
// High-Resolution Screenshot Export
// ==========================================
document.getElementById('btn-export-original')?.addEventListener('click', async () => {
  popoverExport?.classList.remove('open');
  const texSize = viewer.getModelTextureSize();
  if (texSize && texSize.width > 0 && texSize.height > 0) {
    showTip(`📸 正在按模型实际贴图尺寸 (${texSize.width}×${texSize.height}) 渲染原画质截图...`);
  } else {
    showTip('📸 正在生成原画质无损截图...');
  }
  await viewer.exportImage({ originalQuality: true, download: true });
  showTip('✅ 原画质无损截图下载已触发');
  setTimeout(hideTip, 2500);
});

document.getElementById('btn-export-1x')?.addEventListener('click', async () => {
  popoverExport?.classList.remove('open');
  showTip('📸 正在生成 1x 标清截图...');
  await viewer.exportImage({ scale: 1, download: true, filename: 'model-1x.png' });
  showTip('✅ 1x 标清截图下载已触发');
  setTimeout(hideTip, 2500);
});

document.getElementById('btn-export-2x')?.addEventListener('click', async () => {
  popoverExport?.classList.remove('open');
  showTip('📸 正在生成 2x 高清 (2K) 截图...');
  await viewer.exportImage({ scale: 2, download: true, filename: 'model-2k-hd.png' });
  showTip('✅ 2x 高清截图下载已触发');
  setTimeout(hideTip, 2500);
});

document.getElementById('btn-export-4x')?.addEventListener('click', async () => {
  popoverExport?.classList.remove('open');
  showTip('🖼️ 正在生成 4x 超清 (4K) 截图...');
  await viewer.exportImage({ scale: 4, download: true, filename: 'model-4k-uhd.png' });
  showTip('✅ 4x 超清截图下载已触发');
  setTimeout(hideTip, 2500);
});
