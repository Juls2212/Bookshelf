import {
  ArrowRight,
  Book,
  Check,
  ChevronLeft,
  CircleAlert,
  Ellipsis,
  Eye,
  EyeOff,
  House,
  Image,
  LibraryBig,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Scan,
  Search,
  Sparkles,
  Star,
  Sun,
  Trash2,
  User,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react-native';

import { useTheme } from './ThemeProvider';
import { sizes } from './tokens';

const icons = {
  home: House,
  library: LibraryBig,
  scan: Scan,
  sparkles: Sparkles,
  user: User,
  search: Search,
  plus: Plus,
  pencil: Pencil,
  trash: Trash2,
  image: Image,
  zap: Zap,
  sun: Sun,
  'chevron-left': ChevronLeft,
  ellipsis: Ellipsis,
  eye: Eye,
  'eye-off': EyeOff,
  x: X,
  refresh: RefreshCw,
  'log-out': LogOut,
  'alert-circle': CircleAlert,
  check: Check,
  book: Book,
  star: Star,
  'arrow-right': ArrowRight,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof icons;

export const iconNames = Object.keys(icons) as IconName[];

type IconProps = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill color for solid icons (e.g. a selected star). */
  fill?: string;
};

// Icons are decorative; the interactive parent provides the accessible label.
export function Icon({
  name,
  size = sizes.iconMd,
  color,
  strokeWidth = 1.75,
  fill = 'none',
}: IconProps) {
  const { colors } = useTheme();
  const Component = icons[name];
  return (
    <Component
      size={size}
      color={color ?? colors.textPrimary}
      strokeWidth={strokeWidth}
      fill={fill}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
