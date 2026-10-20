import './ui/styles.css';
import { Game } from './core/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLDivElement;
const game = new Game(canvas, ui);
game.start();

// Expose for debugging in the console.
(window as unknown as { smashCourt: Game }).smashCourt = game;
