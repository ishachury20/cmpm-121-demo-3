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
const TILE_DEGREES = 1e-4; //0.0001
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

document.addEventListener("DOMContentLoaded", () => {
  // Movement increment (change as you see fit)
  const moveDistance = TILE_DEGREES; // This could be any suitable value

  // Function to update player's position
  function movePlayer(latChange: number, lngChange: number) {
    const currentPosition = playerMarker.getLatLng();
    const newLat = currentPosition.lat + latChange;
    const newLng = currentPosition.lng + lngChange;
    playerMarker.setLatLng([newLat, newLng]);
    map.panTo([newLat, newLng]); // recenters the map if desired
  }

  // Event listeners for movement buttons
  const northButton = document.getElementById("north")!;
  northButton.addEventListener("click", () => movePlayer(moveDistance, 0));

  const southButton = document.getElementById("south")!;
  southButton.addEventListener("click", () => movePlayer(-moveDistance, 0));

  const eastButton = document.getElementById("east")!;
  eastButton.addEventListener("click", () => movePlayer(0, moveDistance));

  const westButton = document.getElementById("west")!;
  westButton.addEventListener("click", () => movePlayer(0, -moveDistance));
});

const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = `Player has no coins`;

// Interfaces for cache, coin, and user coins
// This interface is specifically created for the icon/pop-up used on all caches
interface CacheIntrinsic {
  icon: leaflet.Icon;
  popupTemplate: (latLng: leaflet.LatLng, coins: Coin[]) => string;
}

// This interface is for the cache itself (not the visual aspects of it)
interface Cache {
  coins: Coin[];
  marker: leaflet.Marker;
}

// This interface is used for the coin/token the player can collect or depoit to other caches
interface Coin {
  serial: number; // Serial number for each coin
  initialLat: number; // x-coordinate
  initialLng: number; // y-coordinate
}

// This interface is for all of the coins the user currently has
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

      // Pop-up that appears when user hovers over a location (red icon)
      // Used the example (and asked Brace a little) to help me understand this and use it

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

// Talked to Jack O'Brien and Jacky Sanchez to help understand how to create this function (asked them for a general understanding of how this assignment was supposed to be done)
// Got rid of the positionkey system in the first implementation, and based this solely on coordinate positions
// Talked to Jacky about her implementation and used a similar idea (in which there is a list for all coins in a specific cache as well as a list containing all of the player's coins)
// Coins are popped from one list to another to keep track of which cache they end up in

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

      if (!caches.has(positionKey)) { // making sure caches are not repeated
        const randomValue = luck(positionKey);
        if (randomValue < CACHE_SPAWN_PROBABILITY) {
          // Used YazmynS's code (for this) to understand how to write this and what it does
          // I used their code in my file to generate deterministically generated coins

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

          // Used ChatGPT to help me write this code
          // Prompt: Help me deterministically generate locations using these interfaces that implement the flyweight pattern
          // I inputted my code and iterated on the prompts to get correct(ish) responses

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
