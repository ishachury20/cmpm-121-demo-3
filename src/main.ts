// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css"; // Style sheets
import "./style.css";
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

const app: HTMLDivElement = document.querySelector("#app")!;
const gameName = "Geocoin Carrier";
document.title = gameName;
const header = document.createElement("h1");
header.innerHTML = gameName;
app.prepend(header);

// Location of our classroom (as identified on Google Maps)
// Tested for other locations with Jacky's help (over a discord call)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19; //19
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = `Player has no coins`;

// movePlayer and helpers: Refactored for modularity
function movePlayer(latChange: number, lngChange: number) {
  const newPosition = updatePlayerPosition(latChange, lngChange);
  panMapToPlayer(newPosition);
  trackPlayerMovement(newPosition);
  updateCachesAroundPlayer(newPosition);
  saveGameState();
}

function updatePlayerPosition(
  latChange: number,
  lngChange: number,
): leaflet.LatLng {
  const currentPosition = playerMarker.getLatLng();
  const newLat = currentPosition.lat + latChange;
  const newLng = currentPosition.lng + lngChange;
  const newPosition = leaflet.latLng(newLat, newLng);

  playerMarker.setLatLng(newPosition); // Reuse playerMarker directly
  return newPosition;
}

function panMapToPlayer(newPosition: leaflet.LatLng) {
  map.panTo(newPosition);
}

function trackPlayerMovement(newPosition: leaflet.LatLng) {
  playerMovementHistory.push(newPosition);
  movementPolyline.setLatLngs(playerMovementHistory);
}

function updateCachesAroundPlayer(playerPosition: leaflet.LatLng) {
  generateAndRenderCaches(playerPosition);
  updateVisibleCaches(playerPosition, 40);
}

function generateAndRenderCaches(playerPosition: leaflet.LatLng) {
  generateCaches(playerPosition, NEIGHBORHOOD_SIZE, TILE_DEGREES);
}

function setupResetListener() {
  const resetButton = document.getElementById("reset");
  resetButton?.addEventListener("click", resetGameState);
}

function setupMovementListeners(moveDistance: number) {
  document.getElementById("north")?.addEventListener(
    "click",
    () => movePlayer(moveDistance, 0),
  );
  document.getElementById("south")?.addEventListener(
    "click",
    () => movePlayer(-moveDistance, 0),
  );
  document.getElementById("east")?.addEventListener(
    "click",
    () => movePlayer(0, moveDistance),
  );
  document.getElementById("west")?.addEventListener(
    "click",
    () => movePlayer(0, -moveDistance),
  );
}

document.addEventListener("DOMContentLoaded", () => {
  setupResetListener();
  const moveDistance = TILE_DEGREES;
  setupMovementListeners(moveDistance);
});

// Interfaace to implement the momento pattern
interface Memento<T> {
  toMemento(): T;
  fromMemento(memento: T): void;
}

// Interfaces for cache, coin, and user coins
// This interface is specifically created for the icon/pop-up used on all caches
interface CacheIntrinsic {
  icon: leaflet.Icon;
  popupTemplate: (latLng: leaflet.LatLng, coins: Coin[]) => string;
}

interface CacheState {
  coins: Coin[];
  latLng: leaflet.LatLng;
}

// This interface is for the cache itself (not the visual aspects of it)
// Extended to use the momento pattern
interface Cache extends Memento<string> {
  coins: Coin[];
  marker: leaflet.Marker;
  initialCoinCount: number;
}

// This interface is used for the coin/token the player can collect or depoit to other caches
interface Coin {
  serial: number;
  initialLat: number;
  initialLng: number;
}

// This interface is for all of the coins the user currently has
interface UserCoin {
  serial: number;
  latLng: leaflet.LatLng;
  initialLat: number;
  initialLng: number;
}

interface SerializedUserCoin {
  serial: number;
  initialLat: number;
  initialLng: number;
}

// Data structures
const caches: Map<string, Cache> = new Map();
const userCoins: UserCoin[] = [];

// Cell class for Flyweight pattern
// I went to Ishaan's office hours to help understand how to approach this function and his help in debugging
// I also used Brace to help write some parts of the code

class Cell {
  static cellInstances: Map<string, Cell> = new Map();
  private constructor(public readonly i: number, public readonly j: number) {}

  static getCell(lat: number, lng: number): Cell {
    const i = Math.floor(lat / TILE_DEGREES);
    const j = Math.floor(lng / TILE_DEGREES);
    const cellKey = `${i},${j}`;
    let cell = Cell.cellInstances.get(cellKey);
    if (!cell) {
      cell = new Cell(i, j);
      Cell.cellInstances.set(cellKey, cell);
    }
    return cell;
  }
}

// I used Brace to help me create and understand this code to implement the flyweight pattern
// Brace suggested to create an interface for the cache (surrounding the pop-ups) and a class that managed the pop-up
// Most of the code used in this is from Brace, though I did go through it to understand it and add to it
// The cachefactory checks if there is already an existing icon in the location and if not creates an icon there, and attaching a pop-up
// CacheIntrinsic and CacheFactory are used to implement the flyweight pattern

// Refactored cacheFactory for D3e (reduce coupling)
function createCacheIcon(iconUrl: string): leaflet.Icon {
  return leaflet.icon({
    iconUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    tooltipAnchor: [16, -28],
  });
}

function createPopupTemplate(latLng: leaflet.LatLng, coins: Coin[]): string {
  return `
      <div id="popup-${latLng.lat},${latLng.lng}">
        <p>Cache at (${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)})</p>
        <p>Coins: <span id="coin-count-${latLng.lat},${latLng.lng}">${coins.length}</span></p>
        <button id="add-coin-${latLng.lat},${latLng.lng}">Collect Coin</button>
        <button id="remove-coin-${latLng.lat},${latLng.lng}">Deposit Coin</button>
      </div>
  `;
}

class CacheFactory {
  private static cacheTypes: Map<string, CacheIntrinsic> = new Map();

  public static getCacheType(iconUrl: string): CacheIntrinsic {
    let cacheType = CacheFactory.cacheTypes.get(iconUrl);

    if (!cacheType) {
      const icon = createCacheIcon(iconUrl);
      const popupTemplate = createPopupTemplate; // Reference helper
      cacheType = { icon, popupTemplate };
      CacheFactory.cacheTypes.set(iconUrl, cacheType);
    }

    return cacheType;
  }
}

class Geocache implements Cache {
  coins: Coin[];
  marker: leaflet.Marker;
  initialCoinCount: number;

  constructor(coins: Coin[], marker: leaflet.Marker) {
    this.coins = coins;
    this.marker = marker;
    this.initialCoinCount = coins.length;
  }

  // Convert cache state to a string
  toMemento(): string {
    const state: CacheState = {
      coins: [...this.coins],
      latLng: this.marker.getLatLng(),
    };
    return JSON.stringify(state);
  }

  // Restore cache state from a string
  fromMemento(memento: string) {
    const state: CacheState = JSON.parse(memento);
    this.coins = state.coins;
    this.marker.setLatLng(state.latLng);
  }
}

function saveGameState() {
  const playerPosition = playerMarker.getLatLng();

  const playerCoinData = userCoins.map((coin) => ({
    serial: coin.serial,
    initialLat: coin.initialLat,
    initialLng: coin.initialLng,
  }));

  const cacheData: Record<string, CacheState> = {};
  caches.forEach((cache, key) => {
    if (map.hasLayer(cache.marker)) { // Only save visible caches
      cacheData[key] = {
        coins: cache.coins,
        latLng: cache.marker.getLatLng(),
      };
    }
  });

  const gameState = {
    playerPosition,
    playerCoins: playerCoinData, // Store player's current coins
    caches: cacheData,
    statusPanelContent: statusPanel.innerHTML,
  };

  localStorage.setItem("gameState", JSON.stringify(gameState));
  console.log("Game state saved!");
}

function loadGameState() {
  const savedState = localStorage.getItem("gameState");
  if (!savedState) {
    console.log("No saved state found.");
    return;
  }

  console.log("Loading game state...");
  const gameState = JSON.parse(savedState);
  const playerCoinsData: SerializedUserCoin[] = gameState.playerCoins;

  restorePlayerPosition(gameState.playerPosition);
  restorePlayerCoins(playerCoinsData);
  restoreCaches(gameState.caches);
  restoreUIState(gameState.statusPanelContent);

  updateVisibleCaches(playerMarker.getLatLng(), 40);
}

function restorePlayerPosition(playerPosition: leaflet.LatLngLiteral) {
  playerMarker.setLatLng([playerPosition.lat, playerPosition.lng]);
  panMapToPlayer(leaflet.latLng(playerPosition.lat, playerPosition.lng));
}

function restorePlayerCoins(playerCoinsData: SerializedUserCoin[]) {
  userCoins.length = 0; // Clear existing coins
  playerCoinsData.forEach((coin) => {
    userCoins.push({
      serial: coin.serial,
      latLng: leaflet.latLng(coin.initialLat, coin.initialLng),
      initialLat: coin.initialLat,
      initialLng: coin.initialLng,
    });
  });
}

function restoreCaches(cacheStates: Record<string, CacheState>) {
  caches.clear();
  Object.keys(cacheStates).forEach((key) => {
    const cacheState = cacheStates[key];
    const cacheIntrinsic = CacheFactory.getCacheType(
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
    );
    const cacheMarker = leaflet.marker(cacheState.latLng, {
      icon: cacheIntrinsic.icon,
    });

    // Attach popups
    cacheMarker.bindPopup(
      cacheIntrinsic.popupTemplate(cacheState.latLng, cacheState.coins),
    );
    attachPopupListeners(
      cacheMarker,
      cacheState.latLng.lat,
      cacheState.latLng.lng,
    );

    // Add to the global cache map
    caches.set(key, new Geocache(cacheState.coins, cacheMarker));
  });
}

function restoreUIState(statusPanelContent: string) {
  if (statusPanelContent) {
    statusPanel.innerHTML = statusPanelContent;
  }
}

// Regenerate Caches on Load
document.addEventListener("DOMContentLoaded", () => {
  loadGameState();
  globalThis.addEventListener("beforeunload", saveGameState); // Save before closing
});

function updateVisibleCaches(center: leaflet.LatLng, radius: number) {
  caches.forEach((cache, key) => {
    const distance = center.distanceTo(cache.marker.getLatLng());
    console.log(`Cache ${key} is at distance ${distance} from player.`);
    if (distance <= radius) {
      if (!map.hasLayer(cache.marker)) {
        cache.marker.addTo(map); // Add visible cache
        console.log(`Cache ${key} shown.`);
      }
    } else if (map.hasLayer(cache.marker)) {
      map.removeLayer(cache.marker); // Hide invisible cache
      console.log(`Cache ${key} hidden.`);
    }
  });
}

// Talked to Jack O'Brien and Jacky Sanchez to help understand how to create this function (asked them for a general understanding of how this assignment was supposed to be done)
// Got rid of the positionkey system in the first implementation, and based this solely on coordinate positions
// Talked to Jacky about her implementation and used a similar idea (in which there is a list for all coins in a specific cache as well as a list containing all of the player's coins)
// Coins are popped from one list to another to keep track of which cache they end up in

function generateCacheData(
  center: leaflet.LatLng,
  neighborhoodSize: number,
  tileDegrees: number,
  spawnProbability: number, // Added the argument
): CacheState[] {
  const generatedCaches: CacheState[] = [];

  for (let x = -neighborhoodSize; x <= neighborhoodSize; x++) {
    for (let y = -neighborhoodSize; y <= neighborhoodSize; y++) {
      const lat = center.lat + x * tileDegrees;
      const lng = center.lng + y * tileDegrees;
      const cell = Cell.getCell(lat, lng);
      const positionKey = `${cell.i},${cell.j}`;

      // Skip if cache already exists
      if (!caches.has(positionKey)) {
        const randomValue = luck(positionKey);

        // Used YazmynS's code (for this) to understand how to write this and what it does
        // I used their code in my file to generate deterministically generated coins

        if (randomValue < spawnProbability) {
          const numCoins =
            Math.floor(luck([lat, lng, "initialValue"].toString()) * 100) + 1;
          const coins: Coin[] = [];
          for (let i = 0; i < numCoins; i++) {
            coins.push({ serial: i, initialLat: lat, initialLng: lng });
          }

          generatedCaches.push({
            coins,
            latLng: leaflet.latLng(lat, lng),
          });
        }
      }
    }
  }

  return generatedCaches;
}

// Brace suggestion for coupling code smell
// Refactored code to create individual functions to keep track of cache data and user interface elements (pop-up)
function renderCacheMarkers(cacheData: CacheState[]) {
  cacheData.forEach((cache) => {
    const positionKey = `${Math.floor(cache.latLng.lat / TILE_DEGREES)},${
      Math.floor(cache.latLng.lng / TILE_DEGREES)
    }`;

    // Create cache marker
    // Used ChatGPT to help me write this code
    // Prompt: Help me deterministically generate locations using these interfaces that implement the flyweight pattern
    // I inputted my code and iterated on the prompts to get correct(ish) responses
    const cacheIntrinsic = CacheFactory.getCacheType(
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
    );
    const cacheMarker = leaflet.marker(
      leaflet.latLng(cache.latLng.lat, cache.latLng.lng),
      { icon: cacheIntrinsic.icon },
    );

    // Bind the popup
    cacheMarker.bindPopup(
      cacheIntrinsic.popupTemplate(cache.latLng, cache.coins),
    );
    attachPopupListeners(cacheMarker, cache.latLng.lat, cache.latLng.lng);

    // Add the cache to the map and global caches data structure
    const newCache = new Geocache(cache.coins, cacheMarker);
    caches.set(positionKey, newCache);
  });
}

function generateCaches(
  center: leaflet.LatLng,
  neighborhoodSize: number,
  tileDegrees: number,
) {
  // Pass spawn probability explicitly
  const cacheData = generateCacheData(
    center,
    neighborhoodSize,
    tileDegrees,
    CACHE_SPAWN_PROBABILITY,
  );
  renderCacheMarkers(cacheData);
}

const playerMovementHistory: leaflet.LatLng[] = [OAKES_CLASSROOM];

// Create the polyline and add it to the map
const movementPolyline = leaflet.polyline(playerMovementHistory, {
  color: "blue", // Choose a color for the polyline
  weight: 3, // Set line thickness
}).addTo(map);

let geolocationWatchId: number | null = null; // To keep track of the geolocation

document.getElementById("sensor")?.addEventListener("click", () => {
  if (geolocationWatchId !== null) {
    navigator.geolocation.clearWatch(geolocationWatchId);
    geolocationWatchId = null;
    alert("Geolocation tracking disabled.");
  } else {
    alert("Geolocation tracking enabled.");
    geolocationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const newLatLng = leaflet.latLng(latitude, longitude);
        playerMarker.setLatLng(newLatLng);
        panMapToPlayer(newLatLng);

        // Regenerate caches and update visibility
        generateCaches(
          playerMarker.getLatLng(),
          NEIGHBORHOOD_SIZE,
          TILE_DEGREES,
        );
        updateVisibleCaches(playerMarker.getLatLng(), 40);
        saveGameState();
      },
    );
  }
});

function attachPopupButtons(lat: number, lng: number) {
  const positionKey = `${Math.floor(lat / TILE_DEGREES)},${
    Math.floor(lng / TILE_DEGREES)
  }`;
  const cache = caches.get(positionKey);

  const addCoinButton = document.getElementById(`add-coin-${lat},${lng}`);
  const removeCoinButton = document.getElementById(`remove-coin-${lat},${lng}`);

  // Add coin logic (connect UI to logic)
  addCoinButton?.addEventListener("click", () => {
    if (cache) {
      const collectedCoin = addCoins(userCoins, cache);
      if (collectedCoin) {
        // Update UI after logic succeeds
        updateCoinCountDisplay(lat, lng, cache.coins.length);
        saveGameState(); // Save updated game state
        console.log(`Collected coin from (${lat}, ${lng}):`, collectedCoin);
      } else {
        console.log("No coins left in the cache to collect.");
      }
    }
  });

  // Deposit coin logic (connect UI to logic)
  removeCoinButton?.addEventListener("click", () => {
    if (cache) {
      const depositedCoin = depositCoin(userCoins, cache);
      if (depositedCoin) {
        // Update UI after logic succeeds
        updateCoinCountDisplay(lat, lng, cache.coins.length);
        saveGameState(); // Save updated game state
        console.log(`Deposited coin into (${lat}, ${lng}):`, depositedCoin);
      } else {
        console.log("Player has no coins to deposit.");
      }
    }
  });
}

// Separate game logic
function handlePopupOpenEvent(lat: number, lng: number) {
  const cell = Cell.getCell(lat, lng);
  const positionKey = `${cell.i},${cell.j}`;
  const cache = caches.get(positionKey);

  if (!cache) return;

  console.log(`Cache state: ${cache.coins.length} coins at (${lat}, ${lng})`);

  // Return any necessary updates (e.g., coin count or cache details)
  return cache;
}

// UI Listener
function attachPopupListeners(
  cacheMarker: leaflet.Marker,
  lat: number,
  lng: number,
) {
  cacheMarker.on("popupopen", () => {
    const cache = handlePopupOpenEvent(lat, lng);
    if (cache) {
      const updatedPopupContent = createPopupTemplate(
        cache.marker.getLatLng(),
        cache.coins,
      );
      cache.marker.setPopupContent(updatedPopupContent);
      attachPopupButtons(lat, lng); // Still modularized for buttons
    }
  });
}

function updateCoinCountDisplay(lat: number, lng: number, coinCount: number) {
  const coinCountElement = document.getElementById(`coin-count-${lat},${lng}`);
  if (coinCountElement) {
    coinCountElement.textContent = `${coinCount}`;
  }
}

function addCoins(playerCoins: UserCoin[], cache: Cache): Coin | null {
  if (!cache || cache.coins.length === 0) return null;

  const coin = cache.coins.pop();
  if (coin) {
    playerCoins.push({
      serial: coin.serial,
      latLng: leaflet.latLng(coin.initialLat, coin.initialLng),
      initialLat: coin.initialLat,
      initialLng: coin.initialLng,
    });
    return coin;
  }
  return null;
}

function depositCoin(playerCoins: UserCoin[], cache: Cache): Coin | null {
  if (!cache || playerCoins.length === 0) return null;

  const coin = playerCoins.pop();
  if (coin) {
    cache.coins.push({
      serial: coin.serial,
      initialLat: coin.initialLat,
      initialLng: coin.initialLng,
    });
    return coin;
  }
  return null;
}

//Refactored for cohesion
function resetGameState() {
  if (!confirmReset()) return;

  console.log("Resetting game state...");
  resetPlayerPosition();
  resetAllCaches();
  clearGameData();
  saveGameState();
  alert("Game has been reset!");
}

// Helper Functions
function confirmReset(): boolean {
  const confirmed = prompt(
    "Are you sure you want to reset the game? Type 'yes' to confirm.",
  );
  return confirmed?.toLowerCase() === "yes";
}

function resetPlayerPosition() {
  playerMovementHistory.splice(1);
  movementPolyline.setLatLngs(playerMovementHistory);
  playerMarker.setLatLng(OAKES_CLASSROOM);
  panMapToPlayer(OAKES_CLASSROOM);
}

function resetAllCaches() {
  caches.forEach((cache) => {
    const latLng = cache.marker.getLatLng();
    // Restore coins
    cache.coins = Array.from({ length: cache.initialCoinCount }, (_, i) => ({
      serial: i,
      initialLat: latLng.lat,
      initialLng: latLng.lng,
    }));

    // Reset popup content
    const cacheIntrinsic = CacheFactory.getCacheType(
      "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
    );
    const updatedPopupContent = cacheIntrinsic.popupTemplate(
      latLng,
      cache.coins,
    );
    cache.marker.bindPopup(updatedPopupContent);
  });
  updateVisibleCaches(playerMarker.getLatLng(), 40);
}

function clearGameData() {
  userCoins.length = 0;
  localStorage.removeItem("gameState");
  statusPanel.innerHTML = "Player has no coins";
}

generateCaches(OAKES_CLASSROOM, NEIGHBORHOOD_SIZE, TILE_DEGREES);
updateVisibleCaches(OAKES_CLASSROOM, 40);
