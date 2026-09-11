/**
 * @description Initialize mascot references and React state shared by behavior hooks.
 * @param {object} dependencies Explicit runtime and state dependencies.
 * @returns {object} Public values for the composing component.
 */
export function usePetState({
  useRef,
  prefs,
  reduced,
  useEffect,
  DEFAULTS,
  IDLE,
  useState,
  FEATURE_REGISTRY,
  React,
}) {
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const quietRef = useRef(reduced || prefs.focus);
  quietRef.current = reduced || prefs.focus;
  const balanceRequest = useRef({ id: 0, controller: null });
  useEffect(
    () => () => {
      balanceRequest.current.id += 1;
      balanceRequest.current.controller?.abort();
    },
    [],
  );
  const rootRef = useRef(null);
  const aRef = useRef(null);
  const bRef = useRef(null);
  const frontRef = useRef(null);
  const currentRef = useRef("");
  const tokenRef = useRef(0);
  const timerRef = useRef(0);
  const bubbleTimerRef = useRef(0);
  const cfgRef = useRef(DEFAULTS);
  const dragRef = useRef(null);
  const stateRef = useRef(IDLE);
  const busyRef = useRef(false);
  const lastCareRef = useRef(0);
  const lastSeenRef = useRef(Date.now());
  const workingSinceRef = useRef(0);
  const SMRef = useRef(null);
  const GROWRef = useRef(null);
  const ARCRef = useRef(null);
  const orbGeomRef = useRef({
    orbR: 0,
    slots: [],
    labels: [],
    inDelays: [],
    outDelays: [],
    placement: null,
  });
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const pageTimerRef = useRef(0);
  const lastPanelRef = useRef(null);
  const visibleCountRef = useRef(FEATURE_REGISTRY.length);
  const [ready, setReady] = useState(false);
  const [tip, setTip] = useState("");
  const [taskView, setTaskView] = useState({ sessionId: null, data: null });
  const [taskHovered, setTaskHovered] = useState(false),
    [taskFocused, setTaskFocused] = useState(false),
    [taskVisible, setTaskVisible] = useState(true);
  const hoverTimer = useRef(null),
    fitSurfacesRef = useRef(null);
  const [bubble, setBubble] = useState("");
  const accordionName = React.useId();
  const [panel, setPanel] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [inventoryBusy, setInventoryBusy] = useState(false);
  const inventoryBusyRef = useRef(false);
  const pendingResource = useRef(undefined);
  if (pendingResource.current === undefined) {
    try {
      pendingResource.current = JSON.parse(
        sessionStorage.getItem("dsh-kujira:care-pending") || "null",
      );
    } catch {
      pendingResource.current = null;
    }
  }
  const [orbOpen, setOrbOpen] = useState(false);
  const [, setViewportTick] = useState(0);
  const [label, setLabel] = useState("");
  const [, setMeta] = useState(null);
  const [city, setCity] = useState("");
  const [balanceView, setBalanceView] = useState(null);
  const [weatherView, setWeatherView] = useState(null);
  const weatherRequest = useRef(0);
  const [growthView, setGrowthView] = useState(null);
  return {
    prefsRef,
    quietRef,
    balanceRequest,
    rootRef,
    aRef,
    bRef,
    frontRef,
    currentRef,
    tokenRef,
    timerRef,
    bubbleTimerRef,
    cfgRef,
    dragRef,
    stateRef,
    busyRef,
    lastCareRef,
    lastSeenRef,
    workingSinceRef,
    SMRef,
    GROWRef,
    ARCRef,
    orbGeomRef,
    page,
    setPage,
    pageRef,
    pageTimerRef,
    lastPanelRef,
    visibleCountRef,
    ready,
    setReady,
    tip,
    setTip,
    taskView,
    setTaskView,
    taskHovered,
    setTaskHovered,
    taskFocused,
    setTaskFocused,
    taskVisible,
    setTaskVisible,
    hoverTimer,
    fitSurfacesRef,
    bubble,
    setBubble,
    accordionName,
    panel,
    setPanel,
    inventory,
    setInventory,
    inventoryBusy,
    setInventoryBusy,
    inventoryBusyRef,
    pendingResource,
    orbOpen,
    setOrbOpen,
    setViewportTick,
    label,
    setLabel,
    setMeta,
    city,
    setCity,
    balanceView,
    setBalanceView,
    weatherView,
    setWeatherView,
    weatherRequest,
    growthView,
    setGrowthView,
  };
}
