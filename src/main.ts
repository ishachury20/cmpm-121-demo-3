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
// Tested for other locations with Jacky's help (over a discord call)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19; //5
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

// This interface is specifically created for the icon/pop-up used on all caches
interface CacheIntrinsic {
  icon: leaflet.Icon;
  popupTemplate: (
    latLng: leaflet.LatLng,
    coins: Coin[],
  ) => string;
}

// This interface is for the cache itself (not the visual aspects of it)
interface Cache {
  coins: Coin[];
  marker: leaflet.Marker;
}

// This interface is used for the coin/token the player can collect or depoit to other caches
interface Coin {
  serial: number; // serial number for each coin
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

const caches: Map<string, Cache> = new Map(); // Cache storage using lat, lng as keys
const userCoins: UserCoin[] = []; // Creating a list for all of the user's coins (in their possession)

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
        <div class="scroll-container">
          <ul>
            ${
        coins.map((coin) => `
              <li>Serial: ${coin.serial} - Location: (${
          coin.initialLat.toFixed(5)
        }, ${coin.initialLng.toFixed(5)})</li>
            `).join("")
      }
          </ul>
        </div>
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
      const position = leaflet.latLng(lat, lng);
      const positionKey = `${lat},${lng}`;

      if (!caches.has(positionKey)) { // using lat, lng as the key (making sure caches are not repeated)
        const randomValue = luck(positionKey);
        if (randomValue < CACHE_SPAWN_PROBABILITY) {
          // Used YazmynS's code (for this) to understand how to write this and what it does
          // I used their code in my file to generate deterministically generated coins

          const num_coins =
            Math.floor(luck([lat, lng, "initialValue"].toString()) * 100) + 1;
          const coins: Coin[] = [];
          for (let i = 0; i <= num_coins; i++) {
            coins.push({
              serial: i,
              initialLat: lat,
              initialLng: lng,
            });

            // console.log(i, lat, lng);
          }

          // Used ChatGPT to help me write this code
          // Prompt: Help me deterministically generate locations using these interfaces that implement the flyweight pattern
          // I inputted my code and iterated on the prompts to get correct(ish) responses

          const cacheIntrinsic = CacheFactory.getCacheType(
            "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
          );
          const cacheMarker = leaflet.marker(position, {
            icon: cacheIntrinsic.icon,
          }).addTo(map);

          cacheMarker.bindPopup(
            cacheIntrinsic.popupTemplate(position, coins),
          );

          cacheMarker.on("popupopen", () => {
            const addCoinButton = document.getElementById(
              `add-coin-${lat},${lng}`, //positionKey
            );
            const removeCoinButton = document.getElementById(
              `remove-coin-${lat},${lng}`, //positionKey
            );

            // Used Brace to help cut down on repetitive code
            // short-form version of adding event listeners

            addCoinButton?.addEventListener("click", () => {
              addCoins(lat, lng);
            });

            removeCoinButton?.addEventListener("click", () => {
              if (userCoins.length > 0) { // check to make sure the list is not empty
                depositCoin(lat, lng);
              }
            });
          });
          caches.set(positionKey, { coins, marker: cacheMarker });
        }
      }
    }
  }
}

function updatePopupContent(lat: number, lng: number) {
  const positionKey = `${lat},${lng}`;
  const cache = caches.get(positionKey);

  if (cache) {
    const popupContent = `
      <p>Cache at (${lat.toFixed(5)}, ${lng.toFixed(5)})</p>
      <p>Coins: <span id="coin-count-${lat},${lng}">${cache.coins.length}</span></p>
      <div class="scroll-container">
        <ul>
          ${
      cache.coins.map((coin) => `
              <li>Serial: ${coin.serial} - Location: (${
        coin.initialLat.toFixed(5)
      }, ${coin.initialLng.toFixed(5)})</li>
            `).join("")
    }
        </ul>
      </div>
      <button id="add-coin-${lat},${lng}">Collect Coin</button>
      <button id="remove-coin-${lat},${lng}">Deposit Coin</button>
    `;

    const currentPopup = cache.marker.getPopup();
    if (!currentPopup) {
      cache.marker.bindPopup(popupContent).openPopup();
    } else {
      currentPopup.setContent(popupContent);
    }
  }
}

// Used Brace to help refine these functions

function addCoins(lat: number, lng: number) {
  const positionKey = `${lat},${lng}`;
  const cache = caches.get(positionKey);

  if (cache && cache.coins.length > 0) {
    const coinToTransfer = cache.coins.pop(); // Removing a coin from the cache

    if (coinToTransfer) {
      userCoins.push({
        serial: coinToTransfer.serial,
        latLng: leaflet.latLng(lat, lng),
        initialLat: coinToTransfer.initialLat,
        initialLng: coinToTransfer.initialLng,
      });

      updatePopupContent(lat, lng);
      statusPanel.innerHTML =
        `Collected coin #${coinToTransfer.serial} from cache (${
          lat.toFixed(5)
        }, ${lng.toFixed(5)})`;

      console.log(`Remaining coins in cache at (${lat}, ${lng}):`, cache.coins);
      console.log("User Coins List:", userCoins);

      // Update the pop-up coin count
      const coinCountElem = document.getElementById(`coin-count-${lat},${lng}`);
      if (coinCountElem) {
        coinCountElem.textContent = `${cache.coins.length}`;
      }
    }
  }
}

function depositCoin(lat: number, lng: number) {
  const positionKey = `${lat},${lng}`;
  const cache = caches.get(positionKey);

  if (userCoins.length > 0 && cache) {
    const coinToDeposit = userCoins.pop(); // Remove a coin from the user's list

    if (coinToDeposit) {
      const depositedCoin: Coin = {
        serial: coinToDeposit.serial,
        initialLat: coinToDeposit.initialLat,
        initialLng: coinToDeposit.initialLng,
      };

      cache.coins.push(depositedCoin);

      updatePopupContent(lat, lng);
      statusPanel.innerHTML =
        `Deposited coin #${coinToDeposit.serial} into cache (${
          lat.toFixed(5)
        }, ${lng.toFixed(5)})`;

      console.log(`Updated coins in cache at (${lat}, ${lng}):`, cache.coins);
      console.log("User Coins List:", userCoins);

      const coinCountElem = document.getElementById(`coin-count-${lat},${lng}`);
      if (coinCountElem) {
        coinCountElem.textContent = `${cache.coins.length}`;
      }
    }
  }
}

// Generate caches around the player's initial location
generateCaches(OAKES_CLASSROOM, NEIGHBORHOOD_SIZE, TILE_DEGREES);
