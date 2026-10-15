import { mount } from 'svelte';
import './styles/tokens.css';
import './styles/base.css';
import { windowKind } from './lib/api';
import App from './App.svelte';
import ViewerWindow from './ViewerWindow.svelte';

// The same page is the main window and a tab popped out into its own window.
mount(windowKind.kind === 'viewer' ? ViewerWindow : App, {
  target: document.getElementById('app')!,
});
