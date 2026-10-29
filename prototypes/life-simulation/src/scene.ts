import type { Locale } from "./card.js";
import { escapeHtml as e } from "./map.js";
import type { State } from "./model.js";
/** Original geometric artwork; no downloaded assets or 1in8b imagery. */
export function sceneSvg(s: State, locale: Locale, compact = false) {
  const en = locale === "en";
  const shop = s.role === "founder";
  const study = s.role === "student";
  const work = s.role === "employed";
  const shared = s.housing === "shared";
  const temporary = s.housing === "temporary";
  const roof = s.housing === "owned" ? "#a1644e" : "#7d9d98";
  const home = {
    rent: en ? "RENTED HOME" : "租住的小家",
    shared: en ? "SHARED HOME" : "合租的小家",
    owned: en ? "YOUR HOME" : "自己的家",
    temporary: en ? "TEMPORARY STAY" : "临时落脚处",
  }[s.housing];
  const place = shop
    ? en
      ? "OPEN / YOUR SHOP"
      : "营业中 · 你的店"
    : study
      ? en
        ? "CAMPUS STUDIO"
        : "校园工作室"
      : work
        ? en
          ? "NEIGHBOURHOOD OFFICE"
          : "街角办公室"
        : en
          ? "COMMUNITY LIBRARY"
          : "社区图书馆";
  const person = (x: number, y: number, color: string, scale = 1) =>
    `<g transform="translate(${x} ${y}) scale(${scale})"><rect x="-12" y="-44" width="24" height="22" rx="7" fill="#c58b68"/><path d="M-13-34v-15q13-12 26 0v10h-9v-8H-5v13" fill="#3c3e3a"/><rect x="-17" y="-21" width="34" height="35" rx="6" fill="${color}"/><rect x="-14" y="12" width="11" height="25" fill="#384349"/><rect x="4" y="12" width="11" height="25" fill="#384349"/><path d="M-17 37h17m2 0h17" stroke="#2d3538" stroke-width="5"/><path d="M-19-15v27m38-27v27" stroke="#c58b68" stroke-width="9" stroke-linecap="round"/></g>`;
  const windows = (x: number, y: number, n: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `<rect x="${x + i * 34}" y="${y}" width="23" height="31" fill="#f1dcb0"/><path d="M${x + i * 34 + 11} ${y}v31" stroke="#9d9e8a" stroke-width="3"/>`,
    ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${compact ? "0 65 780 280" : "0 0 780 370"}" role="img" aria-label="${e(`${home} · ${place}`)}"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#c9dbdd"/><stop offset="1" stop-color="#f6e8c9"/></linearGradient></defs><rect width="780" height="370" rx="12" fill="url(#sky)"/><circle cx="650" cy="62" r="29" fill="#efd09a"/><g fill="#fff9ec" opacity=".72"><rect x="77" y="43" width="100" height="13" rx="7"/><rect x="110" y="32" width="49" height="20" rx="10"/><rect x="445" y="65" width="88" height="11" rx="6"/></g><g fill="#a7bfc0"><path d="M0 154h54v-53h69v104h40v-76h77v109H0z"/><path d="M595 217v-80h73v-39h59v106h53v54z"/></g><rect y="283" width="780" height="87" fill="#b9b8a2"/><path d="M0 333h780" stroke="#d9d0b8" stroke-width="26"/>
 <g><rect x="55" y="146" width="237" height="141" fill="#eee3ca"/><path d="M40 150l130-75 137 75" fill="${roof}"/><path d="M63 140l107-61 111 61" fill="#89aca5"/>${shared ? '<rect x="155" y="180" width="34" height="107" fill="#ab8e74"/><circle cx="183" cy="234" r="3" fill="#f8e1a7"/><text x="172" y="205" text-anchor="middle" fill="#f8e1a7" font-size="11">B</text>' : ""}${temporary ? '<rect x="56" y="145" width="236" height="143" fill="#d1c8b6"/><rect x="47" y="141" width="254" height="15" fill="#8b9287"/><rect x="76" y="186" width="94" height="88" fill="#a6b7aa"/><rect x="87" y="238" width="68" height="22" fill="#e1dac7"/><rect x="90" y="231" width="23" height="12" fill="#f6eedb"/><rect x="170" y="267" width="22" height="20" fill="#ad906b"/>' : ""}<rect x="79" y="176" width="67" height="65" fill="#64848a"/><rect x="84" y="181" width="57" height="55" fill="#ebd69e"/><path d="M113 179v60m-30-30h60" stroke="#64848a" stroke-width="4"/><rect x="200" y="188" width="56" height="99" fill="#b7765b"/><circle cx="244" cy="242" r="3" fill="#f8e1a7"/><rect x="84" y="243" width="57" height="8" fill="#9b7162"/><g fill="#4c7562"><circle cx="93" cy="236" r="11"/><circle cx="124" cy="235" r="12"/></g><rect x="70" y="261" width="111" height="23" rx="3" fill="#fff8e7"/><text x="125" y="277" text-anchor="middle" fill="#65584b" font-size="12">${e(home)}</text></g>
 <g><rect x="355" y="119" width="290" height="171" fill="${shop ? "#d2ac83" : study ? "#c0c6b7" : "#cdbda8"}"/><rect x="342" y="111" width="315" height="12" fill="#607d7b"/>${windows(383, 140, 7)}<rect x="375" y="217" width="113" height="73" fill="#67888b"/><rect x="384" y="225" width="95" height="54" fill="#c1d4cc"/><rect x="527" y="215" width="87" height="75" fill="#6e8280"/><rect x="536" y="223" width="69" height="67" fill="#a4bbb5"/>${shop ? '<path d="M359 202h282l-16 22H374z" fill="#a65340"/><path d="M385 202h22v22h-22zm46 0h22v22h-22zm46 0h22v22h-22zm46 0h22v22h-22zm46 0h22v22h-22" fill="#f4e4c4"/>' : '<rect x="378" y="248" width="91" height="8" fill="#957b61"/><rect x="399" y="230" width="27" height="18" fill="#476570"/>'}<rect x="370" y="181" width="259" height="25" rx="3" fill="#fff5de"/><text x="500" y="198" text-anchor="middle" fill="#65584b" font-size="13" letter-spacing="2">${e(place)}</text></g>
 <g><rect x="689" y="235" width="9" height="61" fill="#8f7760"/><circle cx="693" cy="209" r="33" fill="#789381"/><circle cx="674" cy="223" r="24" fill="#89a18a"/><circle cx="712" cy="224" r="22" fill="#698774"/><rect x="27" y="269" width="20" height="25" fill="#aa7359"/><path d="M37 271v-36m0 16l-13-13m13 22 12-15" stroke="#66866e" stroke-width="5"/></g>
 ${shared || temporary ? '<g fill="#b49b76" stroke="#8a785e"><rect x="288" y="301" width="25" height="22"/><rect x="270" y="307" width="19" height="16"/></g>' : ""}${person(324, 283, "#a65340", 1.1)}${s.family.partner ? person(276, 289, "#637f83", 0.92) : ""}${s.family.children ? person(235, 310, "#b99d56", 0.6) : ""}${s.family.pet ? '<g fill="#b47950"><ellipse cx="389" cy="323" rx="17" ry="9"/><circle cx="404" cy="314" r="9"/><path d="M396 309l1-11 8 8m2 2 7-8-1 15"/></g>' : ""}<g fill="#dfcdb1"><rect x="457" y="310" width="10" height="4"/><rect x="574" y="341" width="23" height="4"/><rect x="171" y="321" width="18" height="3"/></g>${s.abroad ? '<path d="m673 53 18 4-8 5-3 12-4-2v-11l-12-4z" fill="#667f82"/>' : ""}</svg>`;
}
