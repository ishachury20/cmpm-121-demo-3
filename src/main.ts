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
const OAKES_CLASSROOM = leaflet.latLng(0, 0); // 36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 5;
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

// Display the player's points
//let playerPoints = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!; // element `statusPanel` is defined in index.html
statusPanel.innerHTML = `Player Coins ${playerCoins}`;

// Used ChatGPT to create better markers
// Need to add more to these markers (create a pop-up)
// ChatGPT prompt: how would I create a better icon for the caches given this code
const redIcon = leaflet.icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  iconSize: [25, 41], // Default size for Leaflet markers
  iconAnchor: [12, 41], // Position the icon so it points to the location
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
});

// Used Brace to understand Leaflet.LatLng
interface Cache {
  coins: number;
  marker: leaflet.Marker;
}

const caches: Map<string, Cache> = new Map();

function updatePlayerCoinsDisplay() {
  statusPanel.innerHTML = `Player Coins: ${playerCoins}`;
}

function generateCaches(
  center: leaflet.LatLng,
  neighborhoodSize: number,
  tileDegrees: number,
) {
  for (let x = -neighborhoodSize; x <= neighborhoodSize; x++) {
    for (let y = -neighborhoodSize; y <= neighborhoodSize; y++) {
      const positionKey = `${x},${y}`;
      const randomValue = luck(positionKey);

      if (randomValue < CACHE_SPAWN_PROBABILITY) {
        const lat = center.lat + x * tileDegrees;
        const lng = center.lng + y * tileDegrees;
        const position = leaflet.latLng(lat, lng);

        // Used YazmynS's code (for this) to understand how to write this and what it does
        // I used their code in my file to generate deterministically generated coins
        const coins =
          Math.floor(luck([x, y, "initialValue"].toString()) * 100) + 1;

        const cacheMarker = leaflet.marker(position, { icon: redIcon }).addTo(
          map,
        );

        // Used the example (and asked Brace a little) to help me understand this and use it
        const popupContent = `
          <div>
            <p>Cache at (${lat.toFixed(5)}, ${lng.toFixed(5)})</p>
            <p>Coins: <span id="coin-count-${positionKey}">${coins}</span></p>
            <button id="add-coin-${positionKey}">Add Coin</button>
            <button id="remove-coin-${positionKey}">Remove Coin</button>
          </div>
        `;
        cacheMarker.bindPopup(popupContent);

        // Store cache details in the Map
        caches.set(positionKey, { coins, marker: cacheMarker });

        // Event listener for when the popup opens
        cacheMarker.on("popupopen", () => {
          const addCoinButton = document.getElementById(
            `add-coin-${positionKey}`,
          );
          const removeCoinButton = document.getElementById(
            `remove-coin-${positionKey}`,
          );

          // Add coin functionality
          addCoinButton?.addEventListener("click", () => addCoins(positionKey));

          // Remove coin functionality
          removeCoinButton?.addEventListener(
            "click",
            () => removeCoins(positionKey),
          );
        });
      }
    }
  }
}

function addCoins(positionKey: string) {
  const cache = caches.get(positionKey);
  if (cache && playerCoins > 0) {
    cache.coins += 1;
    playerCoins -= 1;

    updateCoinCountDisplay(positionKey, cache.coins);
    updatePlayerCoinsDisplay();
  }
}

// Remove coin from a cache (player takes a coin from the cache)
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
  if (coinCountElement) { //Used Brace to help write this
    coinCountElement.textContent = coinCount.toString();
  }
}

// Generate caches around the player's initial location (fixed location for testing purposes)
generateCaches(OAKES_CLASSROOM, NEIGHBORHOOD_SIZE, TILE_DEGREES);
