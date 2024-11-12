// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
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
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
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
let playerCoins = 10;
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!;
statusPanel.innerHTML = `Player Coins: ${playerCoins}`;

// This interface is specifically created for the icon/pop-up used on all caches
interface CacheIntrinsic {
  icon: leaflet.Icon;
  popupTemplate: (
    positionKey: string,
    latLng: leaflet.LatLng,
    coins: number,
  ) => string;
}

// This interface is for the cache itself (not the visual aspects of it)
interface Cache {
  coins: number;
  marker: leaflet.Marker;
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

      // Used the example (and asked Brace a little) to help me understand this and use it
      const popupTemplate = (
        positionKey: string,
        latLng: leaflet.LatLng,
        coins: number,
      ) => `
        <div>
          <p>Cache at (${latLng.lat.toFixed(5)}, ${latLng.lng.toFixed(5)})</p>
          <p>Coins: <span id="coin-count-${positionKey}">${coins}</span></p>
          <button id="add-coin-${positionKey}">Add Coin</button>
          <button id="remove-coin-${positionKey}">Remove Coin</button>
        </div>
      `;

      cacheType = { icon, popupTemplate };
      CacheFactory.cacheTypes.set(iconUrl, cacheType);
    }

    return cacheType;
  }
}

// Used Brace to create this line of code
// storing the x and y coordinates of locations
const caches: Map<string, Cache> = new Map();

function updatePlayerCoinsDisplay() {
  statusPanel.innerHTML = `Player Coins: ${playerCoins}`;
}

// Talked to Jack O'Brien and Jacky Sanchez to help understand how to create this function (asked them for a general understanding of how this assignment was supposed to be done)
function generateCaches(
  center: leaflet.LatLng,
  neighborhoodSize: number,
  tileDegrees: number,
) {
  for (let x = -neighborhoodSize; x <= neighborhoodSize; x++) {
    for (let y = -neighborhoodSize; y <= neighborhoodSize; y++) {
      const positionKey = `${x},${y}`;

      if (!caches.has(positionKey)) { // making sure caches are not repeated
        const randomValue = luck(positionKey);
        if (randomValue < CACHE_SPAWN_PROBABILITY) {
          const lat = center.lat + x * tileDegrees;
          const lng = center.lng + y * tileDegrees;
          const position = leaflet.latLng(lat, lng);

          // Used YazmynS's code (for this) to understand how to write this and what it does
          // I used their code in my file to generate deterministically generated coins
          const coins =
            Math.floor(luck([x, y, "initialValue"].toString()) * 100) + 1;

          const cacheIntrinsic = CacheFactory.getCacheType(
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
          );
          const cacheMarker = leaflet.marker(position, {
            icon: cacheIntrinsic.icon,
          }).addTo(map);
          cacheMarker.bindPopup(
            cacheIntrinsic.popupTemplate(positionKey, position, coins),
          );

          caches.set(positionKey, { coins, marker: cacheMarker });

          cacheMarker.on("popupopen", () => {
            const addCoinButton = document.getElementById(
              `add-coin-${positionKey}`,
            );
            const removeCoinButton = document.getElementById(
              `remove-coin-${positionKey}`,
            );

            // Used Brace to help cut down on repetitive code
            // short-form version of adding event listeners
            addCoinButton?.addEventListener(
              "click",
              () => addCoins(positionKey),
            );
            removeCoinButton?.addEventListener(
              "click",
              () => removeCoins(positionKey),
            );
          });
        }
      }
    }
  }
}

// Add coin to a cache
// Coins do not yet have serialized numbers (needs to be implemented)
function addCoins(positionKey: string) {
  const cache = caches.get(positionKey);
  if (cache && playerCoins > 0) {
    cache.coins += 1;
    playerCoins -= 1;

    updateCoinCountDisplay(positionKey, cache.coins);
    updatePlayerCoinsDisplay();
  }
}

// Remove coin from a cache
// Add to the player's count/total
function removeCoins(positionKey: string) {
  const cache = caches.get(positionKey);
  if (cache && cache.coins > 0) {
    cache.coins -= 1;
    playerCoins += 1;

    updateCoinCountDisplay(positionKey, cache.coins);
    updatePlayerCoinsDisplay();
  }
}

function updateCoinCountDisplay(positionKey: string, coinCount: number) {
  const coinCountElement = document.getElementById(`coin-count-${positionKey}`);
  if (coinCountElement) {
    coinCountElement.textContent = coinCount.toString();
  }
}

// Generate caches around the player's initial location
generateCaches(OAKES_CLASSROOM, NEIGHBORHOOD_SIZE, TILE_DEGREES);
