import {
  AirVent, Bell, Blinds, BookOpen, Bot, Briefcase, Calculator, Calendar, Camera, Cat, Clock, Code, Coffee,
  Cpu, Database, DoorOpen, Fan, FileText, Folder, Gauge, Globe, Gpu, HardDrive, House, Lamp, Lightbulb,
  Link, ListTodo, Lock, LockOpen, Mail, MemoryStick, MessageSquare, Monitor, Moon, Music, Network, Palette, Phone, Play, Plug,
  Power, Puzzle, Rocket, Server, Settings, Speaker, Star, Sun, Terminal, Thermometer, Tv, Video, Wifi,
  Workflow, Zap,
} from 'lucide-vue-next';

/** Names usable in any plugin's "Icon" setting. Emoji and image URLs work too. */
export const iconMap = {
  'air-vent': AirVent, bell: Bell, blinds: Blinds, book: BookOpen, bot: Bot, briefcase: Briefcase,
  calculator: Calculator, calendar: Calendar, camera: Camera, cat: Cat, clock: Clock, code: Code, coffee: Coffee,
  cpu: Cpu, database: Database, door: DoorOpen, fan: Fan, file: FileText, folder: Folder, gauge: Gauge,
  globe: Globe, gpu: Gpu, disk: HardDrive, home: House, lamp: Lamp, light: Lightbulb, link: Link, todo: ListTodo,
  lock: Lock, unlock: LockOpen, mail: Mail, memory: MemoryStick, message: MessageSquare, monitor: Monitor,
  moon: Moon, music: Music, network: Network, palette: Palette, phone: Phone, play: Play, plug: Plug, power: Power, puzzle: Puzzle,
  rocket: Rocket, server: Server, settings: Settings, speaker: Speaker, star: Star, sun: Sun,
  terminal: Terminal, thermometer: Thermometer, tv: Tv, video: Video, wifi: Wifi, workflow: Workflow, zap: Zap,
};

export const iconNames = Object.keys(iconMap).sort();
