// Icons from Lucide (https://lucide.dev, ISC license), bundled as inline SVG text.
import Terminal from 'lucide-static/icons/terminal.svg';
import SquareTerminal from 'lucide-static/icons/square-terminal.svg';
import Server from 'lucide-static/icons/server.svg';
import Plug from 'lucide-static/icons/plug.svg';
import Cable from 'lucide-static/icons/cable.svg';
import Folder from 'lucide-static/icons/folder.svg';
import FolderOpen from 'lucide-static/icons/folder-open.svg';
import FolderPlus from 'lucide-static/icons/folder-plus.svg';
import File from 'lucide-static/icons/file.svg';
import FileText from 'lucide-static/icons/file-text.svg';
import FileCode from 'lucide-static/icons/file-code.svg';
import FileArchive from 'lucide-static/icons/file-archive.svg';
import FileImage from 'lucide-static/icons/file-image.svg';
import Link from 'lucide-static/icons/link.svg';
import Plus from 'lucide-static/icons/plus.svg';
import Zap from 'lucide-static/icons/zap.svg';
import Settings from 'lucide-static/icons/settings.svg';
import Search from 'lucide-static/icons/search.svg';
import X from 'lucide-static/icons/x.svg';
import ChevronRight from 'lucide-static/icons/chevron-right.svg';
import ChevronDown from 'lucide-static/icons/chevron-down.svg';
import ArrowUp from 'lucide-static/icons/arrow-up.svg';
import RefreshCw from 'lucide-static/icons/refresh-cw.svg';
import Upload from 'lucide-static/icons/upload.svg';
import Download from 'lucide-static/icons/download.svg';
import Pencil from 'lucide-static/icons/pencil.svg';
import Trash2 from 'lucide-static/icons/trash-2.svg';
import Copy from 'lucide-static/icons/copy.svg';
import PanelLeftClose from 'lucide-static/icons/panel-left-close.svg';
import PanelLeftOpen from 'lucide-static/icons/panel-left-open.svg';
import Eye from 'lucide-static/icons/eye.svg';
import EyeOff from 'lucide-static/icons/eye-off.svg';
import KeyRound from 'lucide-static/icons/key-round.svg';
import CircleAlert from 'lucide-static/icons/circle-alert.svg';
import CircleCheck from 'lucide-static/icons/circle-check.svg';
import Info from 'lucide-static/icons/info.svg';
import PlugZap from 'lucide-static/icons/plug-zap.svg';
import House from 'lucide-static/icons/house.svg';
import Ellipsis from 'lucide-static/icons/ellipsis.svg';
import Sun from 'lucide-static/icons/sun.svg';
import Moon from 'lucide-static/icons/moon.svg';
import Monitor from 'lucide-static/icons/monitor.svg';
import HardDrive from 'lucide-static/icons/hard-drive.svg';
import ClipboardPaste from 'lucide-static/icons/clipboard-paste.svg';
import Keyboard from 'lucide-static/icons/keyboard.svg';
import RotateCw from 'lucide-static/icons/rotate-cw.svg';
import LoaderCircle from 'lucide-static/icons/loader-circle.svg';
import Radio from 'lucide-static/icons/radio.svg';
import Command from 'lucide-static/icons/command.svg';
import Check from 'lucide-static/icons/check.svg';
import Files from 'lucide-static/icons/files.svg';
import WifiOff from 'lucide-static/icons/wifi-off.svg';
import TriangleAlert from 'lucide-static/icons/triangle-alert.svg';
import ChevronUp from 'lucide-static/icons/chevron-up.svg';
import ArrowDownUp from 'lucide-static/icons/arrow-down-up.svg';
import SearchX from 'lucide-static/icons/search-x.svg';
import CopyPlus from 'lucide-static/icons/copy-plus.svg';

const RAW = {
  'terminal': Terminal,
  'square-terminal': SquareTerminal,
  'server': Server,
  'plug': Plug,
  'cable': Cable,
  'folder': Folder,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  'file': File,
  'file-text': FileText,
  'file-code': FileCode,
  'file-archive': FileArchive,
  'file-image': FileImage,
  'link': Link,
  'plus': Plus,
  'zap': Zap,
  'settings': Settings,
  'search': Search,
  'x': X,
  'chevron-right': ChevronRight,
  'chevron-down': ChevronDown,
  'arrow-up': ArrowUp,
  'refresh-cw': RefreshCw,
  'upload': Upload,
  'download': Download,
  'pencil': Pencil,
  'trash-2': Trash2,
  'copy': Copy,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'eye': Eye,
  'eye-off': EyeOff,
  'key-round': KeyRound,
  'circle-alert': CircleAlert,
  'circle-check': CircleCheck,
  'info': Info,
  'plug-zap': PlugZap,
  'house': House,
  'ellipsis': Ellipsis,
  'sun': Sun,
  'moon': Moon,
  'monitor': Monitor,
  'hard-drive': HardDrive,
  'clipboard-paste': ClipboardPaste,
  'keyboard': Keyboard,
  'rotate-cw': RotateCw,
  'loader-circle': LoaderCircle,
  'radio': Radio,
  'command': Command,
  'check': Check,
  'files': Files,
  'wifi-off': WifiOff,
  'triangle-alert': TriangleAlert,
  'chevron-up': ChevronUp,
  'arrow-down-up': ArrowDownUp,
  'search-x': SearchX,
  'copy-plus': CopyPlus,
} as const;

export type IconName = keyof typeof RAW;

const cache = new Map<string, string>();

function body(name: IconName): string {
  let s = cache.get(name);
  if (!s) {
    // Keep the inner shapes only; sizing and colour are controlled from CSS.
    s = RAW[name].replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[^>]*>/, '').replace('</svg>', '').trim();
    cache.set(name, s);
  }
  return s;
}

/** Creates an inline SVG icon that inherits the current text colour. */
export function icon(name: IconName, size = 16, extraClass = ''): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  svg.innerHTML = body(name); // static bundled markup, never user input
  return svg;
}
