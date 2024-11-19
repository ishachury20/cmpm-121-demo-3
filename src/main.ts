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
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map
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

// Interfaces for cache, coin, and user coins
interface CacheIntrinsic {
  icon: leaflet.Icon;
  popupTemplate: (latLng: leaflet.LatLng, coins: Coin[]) => string;
}

interface Cache {
  coins: Coin[];
  marker: leaflet.Marker;
}

interface Coin {
  serial: number; // Serial number for each coin
  initialLat: number; // x-coordinate
  initialLng: number; // y-coordinate
}

interface UserCoin {
  serial: number;
  latLng: leaflet.LatLng;
  initialLat: number;
  initialLng: number;
}

// Data structures
const caches: Map<string, Cache> = new Map();
const userCoins: UserCoin[] = [];

// Cell class for Flyweight pattern
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

// CacheFactory implementing Flyweight pattern
class CacheFactory {
  private static cacheTypes: Map<string, CacheIntrinsic> = new Map();

  public static getCacheType(iconUrl: string): CacheIntrinsic {
    let cacheType = CacheFactory.cacheTypes.get(iconUrl);

    if (!cacheType) {
      const icon = leaflet.icon({
        iconUrl,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        tooltipAnchor: [16, -28],
      });

      const popupTemplate = (latLng: leaflet.LatLng, coins: Coin[]) => `
        <div id="popup-${latLng.lat},${latLng.lng}">
          <p>Cache at (${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)})</p>
          <p>Coins: <span id="coin-count-${latLng.lat},${latLng.lng}">${coins.length}</span></p>
          <button id="add-coin-${latLng.lat},${latLng.lng}">Collect Coin</button>
          <button id="remove-coin-${latLng.lat},${latLng.lng}">Deposit Coin</button>
        </div>
        `;

      cacheType = { icon, popupTemplate };
      CacheFactory.cacheTypes.set(iconUrl, cacheType);
    }

    return cacheType;
  }
}

// Function to generate caches
function generateCaches(
  center: leaflet.LatLng,
  neighborhoodSize: number,
  tileDegrees: number,
) {
  for (let x = -neighborhoodSize; x <= neighborhoodSize; x++) {
    for (let y = -neighborhoodSize; y <= neighborhoodSize; y++) {
      const lat = center.lat + x * tileDegrees;
      const lng = center.lng + y * tileDegrees;
      const cell = Cell.getCell(lat, lng);
      const positionKey = `${cell.i},${cell.j}`;

      if (!caches.has(positionKey)) {
        const randomValue = luck(positionKey);
        if (randomValue < CACHE_SPAWN_PROBABILITY) {
          const num_coins = Math.floor(
            luck([lat, lng, "initialValue"].toString()) * 100,
          ) + 1;
          const coins: Coin[] = [];
          for (let i = 0; i < num_coins; i++) {
            coins.push({
              serial: i,
              initialLat: lat,
              initialLng: lng,
            });
          }

          const cacheIntrinsic = CacheFactory.getCacheType(
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
          );

          const cacheMarker = leaflet.marker(leaflet.latLng(lat, lng), {
            icon: cacheIntrinsic.icon,
          }).addTo(map);

          cacheMarker.bindPopup(
            cacheIntrinsic.popupTemplate(leaflet.latLng(lat, lng), coins),
          );

          cacheMarker.on("popupopen", () => {
            const addCoinButton = document.getElementById(
              `add-coin-${lat},${lng}`,
            );
            const removeCoinButton = document.getElementById(
              `remove-coin-${lat},${lng}`,
            );

            addCoinButton?.addEventListener("click", () => {
              addCoins(cell.i, cell.j, lat, lng); // Pass lat and lng
            });

            removeCoinButton?.addEventListener("click", () => {
              if (userCoins.length > 0) {
                depositCoin(cell.i, cell.j, lat, lng);
              }
            });
          });

          caches.set(positionKey, { coins, marker: cacheMarker });
        }
      }
    }
  }
}

//statusPanel.innerHTML = `Collected coin #${coinToTransfer.serial}`;

// Functions for coin collection and deposit
function addCoins(i: number, j: number, lat: number, lng: number) {
  const positionKey = `${i},${j}`;
  const cache = caches.get(positionKey);

  if (cache && cache.coins.length > 0) {
    const coinToTransfer = cache.coins.pop();
    if (coinToTransfer) {
      userCoins.push({
        serial: coinToTransfer.serial,
        latLng: leaflet.latLng(lat, lng), // Use passed lat and lng
        initialLat: coinToTransfer.initialLat,
        initialLng: coinToTransfer.initialLng,
      });

      statusPanel.innerHTML =
        `Collected at cache ${i},${j}: #${coinToTransfer.serial}`;

      const coinCountElem = document.getElementById(`coin-count-${lat},${lng}`);
      if (coinCountElem) {
        coinCountElem.textContent = `${cache.coins.length}`;
      }
    }
  }
}

function depositCoin(i: number, j: number, lat: number, lng: number) {
  const positionKey = `${i},${j}`;
  const cache = caches.get(positionKey);

  if (userCoins.length > 0 && cache) {
    const coinToDeposit = userCoins.pop(); // Remove the most recent user coin
    if (coinToDeposit) {
      cache.coins.push({
        serial: coinToDeposit.serial,
        initialLat: coinToDeposit.initialLat,
        initialLng: coinToDeposit.initialLng,
      });

      // Update the status panel
      statusPanel.innerHTML =
        `Deposited at cache ${i}, ${j}: #${coinToDeposit.serial}`;

      // Update the coin count in the cache's popup
      const coinCountElem = document.getElementById(`coin-count-${lat},${lng}`);
      if (coinCountElem) {
        coinCountElem.textContent = `${cache.coins.length}`;
      }
    }
  }
}

// Initial cache generation
generateCaches(OAKES_CLASSROOM, NEIGHBORHOOD_SIZE, TILE_DEGREES);
