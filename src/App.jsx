import React from "react";
import useDataLoader from "./DataLoader/DataLoader";
import Viewer from "./Viewer/Viewer";
import Control from "./Control/Control";
import "./App.css";

export default function App() {
  const dataLoader = useDataLoader();

  return (
    <div className="app-container">
      <Viewer {...dataLoader} />
      <Control {...dataLoader} />
    </div>
  );
}
