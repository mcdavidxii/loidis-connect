// Every icon the app uses comes from this one module.
//
// PLACEHOLDERS: these are currently mapped to lucide-react (an open icon set bundled into
// the app). They are to be replaced by our own icon set later: change the mapping here
// and nothing else needs to change. Do not import an icon library anywhere else.

import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  CalendarRange,
  CalendarDays,
  Car,
  BarChart3,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Clock,
  Copy,
  Download,
  Equal,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Footprints,
  HeartHandshake,
  Info,
  ListChecks,
  Maximize2,
  Minimize2,
  Lock,
  Pencil,
  Play,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  Users,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";

export type IconType = LucideIcon;

// Roster
export const IconTravelCar = Car;
export const IconWalk = Footprints;
export const IconDoubleUp = Users;
export const IconLock = Lock;
export const IconTimeCritical = Clock;
export const IconChanged = Pencil;
export const IconMoved = ArrowLeftRight;
export const IconUnchanged = Check;
export const IconUnallocated = AlertCircle;
export const IconCarer = UserRound;
export const IconClient = Users;
export const IconSearch = Search;
export const IconPrev = ChevronLeft;
export const IconExpand = Maximize2;
export const IconCollapse = Minimize2;
export const IconNext = ChevronRight;
export const IconRefresh = RefreshCw;
export const IconClose = X;
export const IconCopy = Copy;
export const IconPrint = Printer;

// General
export const IconWarning = AlertTriangle;
export const IconOk = CheckCircle2;
export const IconInfo = Info;
export const IconError = XCircle;
export const IconCheck = Check;
export const IconAdd = Plus;
export const IconDelete = Trash2;
export const IconDownload = Download;
export const IconUpload = Upload;
export const IconSync = CloudDownload;
export const IconFileSheet = FileSpreadsheet;
export const IconFileText = FileText;
export const IconDemo = FlaskConical;
export const IconPlay = Play;
export const IconRerun = RotateCcw;
export const IconSparkles = Sparkles;
export const IconListChecks = ListChecks;
export const IconSettings = Settings;
export const IconReview = CalendarRange;
export const IconSchedule = CalendarDays;
export const IconArrowUp = ArrowUp;
export const IconArrowDown = ArrowDown;
export const IconArrowRight = ArrowRight;
export const IconEqual = Equal;

// Overview figures
export const IconStatBookings = ClipboardCheck;
export const IconStatTravel = Car;
export const IconStatMiles = Route;
export const IconStatContinuity = HeartHandshake;
export const IconStatHours = Clock;
export const IconStatSpread = BarChart3;
export const IconStatMoved = ArrowLeftRight;
export const IconStatUnallocated = AlertCircle;
