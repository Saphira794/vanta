import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type GamePlatform = "steam" | "epic" | "manual";

type Game = {
  id: string;
  title: string;
  platform: GamePlatform;
  appId?: string;
  exePath: string;
  localImage?: string;
};

let games: Game[] = [];
let selectedGameId: string | null = null;
let editingId: string | null = null;
let contextMenuGameId: string | null = null;
let activeBgLayer: 1 | 2 = 1;

type Settings = {
  cardSize: "small" | "medium" | "large";
};

const defaultSettings: Settings = {
  cardSize: "medium",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem("vanta.settings");
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (parsed.cardSize !== "small" && parsed.cardSize !== "medium" && parsed.cardSize !== "large") {
      return defaultSettings;
    }
    return {
      ...defaultSettings,
      ...parsed,
    };
  } catch {
    return defaultSettings;
  }
}

function saveSettings(next: Settings) {
  localStorage.setItem("vanta.settings", JSON.stringify(next));
}

function steamHeroUrl(appId: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`;
}

function steamPosterUrl(appId: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
}

function steamHeaderUrl(appId: string) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

const imageExistsCache = new Map<string, boolean>();

function imageExists(url: string): Promise<boolean> {
  const cached = imageExistsCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const img = new Image();
    let done = false;

    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      imageExistsCache.set(url, ok);
      resolve(ok);
    };

    const timeout = window.setTimeout(() => finish(false), 2500);

    img.onload = () => {
      window.clearTimeout(timeout);
      finish(true);
    };
    img.onerror = () => {
      window.clearTimeout(timeout);
      finish(false);
    };
    img.referrerPolicy = "no-referrer";
    img.src = url;
  });
}

async function getBestSteamImage(appId: string): Promise<string | null> {
  const hero = steamHeroUrl(appId);
  const header = steamHeaderUrl(appId);

  if (await imageExists(hero)) return hero;
  if (await imageExists(header)) return header;
  return null;
}

async function resolveBackground(game: Game): Promise<string | null> {
  if (game.platform === "steam" && game.appId) {
    const steamImage = await getBestSteamImage(game.appId);
    if (steamImage) return steamImage;
  }

  if (!game.localImage) return null;
  if (/^https?:\/\//i.test(game.localImage)) return game.localImage;
  if (game.localImage.startsWith("/")) return game.localImage;
  return convertFileSrc(game.localImage);
}

function setHeroBackground(url: string | null) {
  void changeAppBackground(url);
}

function getBgEl(id: "bg1" | "bg2") {
  return document.querySelector<HTMLElement>(`#${id}`);
}

function normalizeBgUrl(url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return url;
  return convertFileSrc(url);
}

async function changeAppBackground(url: string | null) {
  const bg1 = getBgEl("bg1");
  const bg2 = getBgEl("bg2");
  if (!bg1 || !bg2) return;

  const nextUrl = normalizeBgUrl(url);
  if (!nextUrl) {
    bg1.classList.remove("is-active");
    bg2.classList.remove("is-active");
    bg1.style.removeProperty("background-image");
    bg2.style.removeProperty("background-image");
    return;
  }

  const nextLayer = activeBgLayer === 1 ? 2 : 1;
  const nextEl = nextLayer === 1 ? bg1 : bg2;
  const prevEl = nextLayer === 1 ? bg2 : bg1;

  nextEl.style.backgroundImage = `url('${nextUrl}')`;
  // Ensure transition triggers
  requestAnimationFrame(() => {
    nextEl.classList.add("is-active");
    prevEl.classList.remove("is-active");
    activeBgLayer = nextLayer;
  });
}

function setSelectedGameText(game: Game) {
  const titleEl = document.querySelector<HTMLElement>("#game-title");
  const metaEl = document.querySelector<HTMLElement>("#game-meta");
  if (titleEl) titleEl.textContent = game.title;
  if (metaEl) metaEl.textContent = `${game.platform}${game.appId ? ` • AppID ${game.appId}` : ""}`;
}

async function selectGame(game: Game) {
  setSelectedGameText(game);
  const bg = await resolveBackground(game);
  setHeroBackground(bg);

  selectedGameId = game.id;
  setButtonsEnabled(true);
  updateSelectedStyles();
  updateSelectedGridStyles();
  if (editingId === null) {
    fillEditorFromGame(game);
  }
}

function renderGameList() {
  const list = document.querySelector<HTMLElement>("#game-list");
  if (!list) return;

  list.innerHTML = "";

  for (const game of games) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "game-item";
    btn.dataset.gameId = game.id;
    btn.textContent = game.title;
    btn.addEventListener("click", () => {
      void selectGame(game);
    });
    list.appendChild(btn);
  }
}

function updateSelectedStyles() {
  const list = document.querySelector<HTMLElement>("#game-list");
  if (!list) return;
  const items = list.querySelectorAll<HTMLButtonElement>(".game-item");
  for (const item of items) {
    const isActive = !!selectedGameId && item.dataset.gameId === selectedGameId;
    item.classList.toggle("is-active", isActive);
  }
}

async function resolveCoverImage(game: Game): Promise<string | null> {
  if (game.localImage) {
    if (/^https?:\/\//i.test(game.localImage)) return game.localImage;
    if (game.localImage.startsWith("/")) return game.localImage;
    return convertFileSrc(game.localImage);
  }

  if (game.platform === "steam" && game.appId) {
    const poster = steamPosterUrl(game.appId);
    const hero = steamHeroUrl(game.appId);
    const header = steamHeaderUrl(game.appId);
    if (await imageExists(poster)) return poster;
    if (await imageExists(hero)) return hero;
    if (await imageExists(header)) return header;
  }

  return null;
}

function updateSelectedGridStyles() {
  const grid = document.querySelector<HTMLElement>("#library-grid");
  if (!grid) return;
  const cards = grid.querySelectorAll<HTMLButtonElement>(".game-card");
  for (const card of cards) {
    const isActive = !!selectedGameId && card.dataset.gameId === selectedGameId;
    card.classList.toggle("is-active", isActive);
  }
}

async function renderLibraryGrid() {
  const grid = document.querySelector<HTMLElement>("#library-grid");
  if (!grid) return;

  grid.innerHTML = "";

  for (const game of games) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "game-card";
    card.dataset.gameId = game.id;
    card.addEventListener("click", () => {
      void selectGame(game);
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openGameMenu(e.clientX, e.clientY, game.id);
    });

    const imgWrap = document.createElement("div");
    imgWrap.className = "game-card-img";

    const cover = await resolveCoverImage(game);
    if (cover) {
      imgWrap.style.backgroundImage = `url('${cover}')`;
    }

    const title = document.createElement("div");
    title.className = "game-card-title";
    title.textContent = game.title;

    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "game-card-menu";
    menuBtn.textContent = "...";
    menuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openGameMenu(rect.right, rect.bottom, game.id);
    });

    card.appendChild(imgWrap);
    card.appendChild(title);
    card.appendChild(menuBtn);
    grid.appendChild(card);
  }

  updateSelectedGridStyles();
}

function getMenuEl() {
  return document.querySelector<HTMLElement>("#game-menu");
}

function closeGameMenu() {
  const menu = getMenuEl();
  if (!menu) return;
  menu.classList.remove("is-open");
  menu.setAttribute("aria-hidden", "true");
  contextMenuGameId = null;
}

function openGameMenu(x: number, y: number, gameId: string) {
  const menu = getMenuEl();
  if (!menu) return;

  contextMenuGameId = gameId;

  menu.classList.add("is-open");
  menu.setAttribute("aria-hidden", "false");

  // After opening, we can measure actual size and clamp into viewport
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  const clampedX = Math.min(x, window.innerWidth - rect.width - margin);
  const clampedY = Math.min(y, window.innerHeight - rect.height - margin);

  menu.style.left = `${Math.max(margin, clampedX)}px`;
  menu.style.top = `${Math.max(margin, clampedY)}px`;
}

async function ensureSelected(gameId: string) {
  const game = games.find((g) => g.id === gameId);
  if (!game) return;
  await selectGame(game);
}

function openSettings() {
  const modal = document.querySelector<HTMLElement>("#settings-modal");
  if (!modal) return;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  const modal = document.querySelector<HTMLElement>("#settings-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

function applyCardSize(size: Settings["cardSize"]) {
  const root = document.documentElement;
  if (size === "small") root.style.setProperty("--card-min-width", "140px");
  if (size === "medium") root.style.setProperty("--card-min-width", "170px");
  if (size === "large") root.style.setProperty("--card-min-width", "220px");
}

function $(selector: string) {
  return document.querySelector(selector);
}

function setStatus(text: string) {
  const el = document.querySelector<HTMLElement>("#status");
  if (!el) return;
  el.textContent = text;
}

function setButtonsEnabled(hasSelection: boolean) {
  const editBtn = document.querySelector<HTMLButtonElement>("#edit-game");
  const delBtn = document.querySelector<HTMLButtonElement>("#delete-game");
  const launchBtn = document.querySelector<HTMLButtonElement>("#launch-game");

  if (editBtn) editBtn.disabled = !hasSelection || editingId !== null;
  if (delBtn) delBtn.disabled = !hasSelection || editingId !== null;

  const selected = getSelectedGame();
  if (launchBtn) launchBtn.disabled = !selected || !selected.exePath || editingId !== null;
}

function setEditorEnabled(enabled: boolean) {
  const title = document.querySelector<HTMLInputElement>("#title");
  const platform = document.querySelector<HTMLSelectElement>("#platform");
  const appId = document.querySelector<HTMLInputElement>("#appId");
  const exePath = document.querySelector<HTMLInputElement>("#exePath");
  const localImage = document.querySelector<HTMLInputElement>("#localImage");
  const pickExe = document.querySelector<HTMLButtonElement>("#pick-exe");
  const pickImage = document.querySelector<HTMLButtonElement>("#pick-image");
  const save = document.querySelector<HTMLButtonElement>("#save-game");
  const cancel = document.querySelector<HTMLButtonElement>("#cancel-edit");

  for (const el of [title, appId]) {
    if (el) el.disabled = !enabled;
  }
  if (platform) platform.disabled = !enabled;
  if (exePath) exePath.disabled = true;
  if (localImage) localImage.disabled = true;
  if (pickExe) pickExe.disabled = !enabled;
  if (pickImage) pickImage.disabled = !enabled;
  if (save) save.disabled = !enabled;
  if (cancel) cancel.disabled = !enabled;
}

function openEditorModal(mode: "add" | "edit") {
  const modal = document.querySelector<HTMLElement>("#editor-modal");
  const title = document.querySelector<HTMLElement>("#editor-title");
  if (!modal) return;

  if (title) title.textContent = mode === "add" ? "Add game" : "Edit game";
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeEditorModal() {
  const modal = document.querySelector<HTMLElement>("#editor-modal");
  if (!modal) return;
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
}

function getSelectedGame(): Game | null {
  if (!selectedGameId) return null;
  return games.find((g) => g.id === selectedGameId) ?? null;
}

function fillEditorFromGame(game: Game | null) {
  const title = document.querySelector<HTMLInputElement>("#title");
  const platform = document.querySelector<HTMLSelectElement>("#platform");
  const appId = document.querySelector<HTMLInputElement>("#appId");
  const exePath = document.querySelector<HTMLInputElement>("#exePath");
  const localImage = document.querySelector<HTMLInputElement>("#localImage");

  if (!game) {
    if (title) title.value = "";
    if (platform) platform.value = "manual";
    if (appId) appId.value = "";
    if (exePath) exePath.value = "";
    if (localImage) localImage.value = "";
    return;
  }

  if (title) title.value = game.title;
  if (platform) platform.value = game.platform;
  if (appId) appId.value = game.appId ?? "";
  if (exePath) exePath.value = game.exePath;
  if (localImage) localImage.value = game.localImage ?? "";
}

async function refreshLibrary(selectId?: string) {
  try {
    games = await invoke<Game[]>("list_games");
    games.sort((a, b) => a.title.localeCompare(b.title));
    renderGameList();
    updateSelectedStyles();
    await renderLibraryGrid();

    if (games.length === 0) {
      selectedGameId = null;
      setButtonsEnabled(false);
      fillEditorFromGame(null);
      setHeroBackground(null);
      setStatus("No games yet. Click Add.");
      return;
    }

    const next = selectId
      ? games.find((g) => g.id === selectId) ?? games[0]
      : selectedGameId
        ? games.find((g) => g.id === selectedGameId) ?? games[0]
        : games[0];
    await selectGame(next);
    setStatus("");
  } catch (e) {
    setStatus(String(e));
  }
}

function startAdd() {
  editingId = "__new__";
  setEditorEnabled(true);
  setButtonsEnabled(!!getSelectedGame());
  fillEditorFromGame({
    id: "__new__",
    title: "",
    platform: "manual",
    exePath: "",
  });
  setStatus("Adding new game");
  openEditorModal("add");
}

function startEdit() {
  const selected = getSelectedGame();
  if (!selected) return;
  editingId = selected.id;
  setEditorEnabled(true);
  setButtonsEnabled(true);
  fillEditorFromGame(selected);
  setStatus("Editing");
  openEditorModal("edit");
}

function cancelEdit() {
  editingId = null;
  setEditorEnabled(false);
  setButtonsEnabled(!!getSelectedGame());
  fillEditorFromGame(getSelectedGame());
  setStatus("");
  closeEditorModal();
}

async function pickExePath() {
  const result = await open({
    multiple: false,
    filters: [{ name: "Executable", extensions: ["exe"] }],
  });
  if (!result || typeof result !== "string") return;
  const exePath = document.querySelector<HTMLInputElement>("#exePath");
  if (exePath) exePath.value = result;
}

async function pickLocalImage() {
  const result = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
  });
  if (!result || typeof result !== "string") return;
  const localImage = document.querySelector<HTMLInputElement>("#localImage");
  if (localImage) localImage.value = result;
}

function buildGameFromEditor(existingId: string | null): Game {
  const title = document.querySelector<HTMLInputElement>("#title")?.value?.trim() ?? "";
  const platform = (document.querySelector<HTMLSelectElement>("#platform")?.value ?? "manual") as GamePlatform;
  const appIdRaw = document.querySelector<HTMLInputElement>("#appId")?.value?.trim() ?? "";
  const exePath = document.querySelector<HTMLInputElement>("#exePath")?.value?.trim() ?? "";
  const localImageRaw = document.querySelector<HTMLInputElement>("#localImage")?.value?.trim() ?? "";

  return {
    id: existingId && existingId !== "__new__" ? existingId : crypto.randomUUID(),
    title,
    platform,
    appId: appIdRaw ? appIdRaw : undefined,
    exePath,
    localImage: localImageRaw ? localImageRaw : undefined,
  };
}

async function saveEditor() {
  try {
    const id = editingId;
    if (!id) return;
    const game = buildGameFromEditor(id);

    if (!game.title) {
      setStatus("Title is required");
      return;
    }
    if (!game.exePath) {
      setStatus("Exe path is required");
      return;
    }

    await invoke<Game[]>("upsert_game", { game });
    editingId = null;
    setEditorEnabled(false);
    await refreshLibrary(game.id);
    setStatus("Saved");
    closeEditorModal();
  } catch (e) {
    setStatus(String(e));
  }
}

async function deleteSelected() {
  const selected = getSelectedGame();
  if (!selected) return;
  try {
    await invoke<Game[]>("delete_game", { id: selected.id });
    selectedGameId = null;
    editingId = null;
    setEditorEnabled(false);
    await refreshLibrary();
    setStatus("Deleted");
  } catch (e) {
    setStatus(String(e));
  }
}

async function launchSelected() {
  const selected = getSelectedGame();
  if (!selected) return;
  try {
    await invoke<void>("launch_game", { exePath: selected.exePath });
    setStatus("Launched");
  } catch (e) {
    setStatus(String(e));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const settings = loadSettings();
  applyCardSize(settings.cardSize);

  const cardSize = document.querySelector<HTMLSelectElement>("#cardSize");
  if (cardSize) {
    cardSize.value = settings.cardSize;
    cardSize.addEventListener("change", () => {
      const next = loadSettings();
      const value = cardSize.value as Settings["cardSize"];
      next.cardSize = value;
      saveSettings(next);
      applyCardSize(value);
    });
  }

  $("#add-game")?.addEventListener("click", () => startAdd());
  $("#edit-game")?.addEventListener("click", () => startEdit());
  $("#delete-game")?.addEventListener("click", () => void deleteSelected());
  $("#launch-game")?.addEventListener("click", () => void launchSelected());
  $("#pick-exe")?.addEventListener("click", () => void pickExePath());
  $("#pick-image")?.addEventListener("click", () => void pickLocalImage());
  $("#cancel-edit")?.addEventListener("click", () => cancelEdit());
  $("#editor-backdrop")?.addEventListener("click", () => {
    if (editingId !== null) cancelEdit();
  });

  $("#open-settings")?.addEventListener("click", () => openSettings());
  $("#close-settings")?.addEventListener("click", () => closeSettings());
  $("#settings-backdrop")?.addEventListener("click", () => closeSettings());

  $("#menu-launch")?.addEventListener("click", () => {
    const id = contextMenuGameId;
    closeGameMenu();
    if (!id) return;
    void ensureSelected(id).then(() => void launchSelected());
  });
  $("#menu-edit")?.addEventListener("click", () => {
    const id = contextMenuGameId;
    closeGameMenu();
    if (!id) return;
    void ensureSelected(id).then(() => startEdit());
  });
  $("#menu-delete")?.addEventListener("click", () => {
    const id = contextMenuGameId;
    closeGameMenu();
    if (!id) return;
    void ensureSelected(id).then(() => void deleteSelected());
  });

  $("#game-menu")?.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  window.addEventListener("click", (e) => {
    const menu = document.querySelector<HTMLElement>("#game-menu");
    const target = e.target as Node | null;
    if (menu && target && menu.contains(target)) return;
    closeGameMenu();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeGameMenu();
      closeSettings();
      if (editingId !== null) cancelEdit();
    }
  });

  const editor = document.querySelector<HTMLFormElement>("#editor");
  editor?.addEventListener("submit", (e) => {
    e.preventDefault();
    void saveEditor();
  });

  setEditorEnabled(false);
  setButtonsEnabled(false);
  void refreshLibrary();
});
