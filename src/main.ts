// todo

import "./style.css";

const app: HTMLDivElement = document.querySelector("#app")!;

const gameName = "Blossom Quest";
document.title = gameName;

const button = document.createElement("button");
button.innerHTML = `Working?`;
button.style.color = "#FFFFFF";

button.onclick = () => {
  alert(`This works properly! :D`);
};

app.append(button);
