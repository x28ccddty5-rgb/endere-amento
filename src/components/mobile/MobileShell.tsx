import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertOctagon,
  ArrowLeftRight,
  Bot,
  Camera,
  Check,
  ChevronRight,
  History,
  Loader2,
  Filter,
  LogOut,
  Package,
  Search,
  Send,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { Divergencia, Galpao, HistoricoMov, Product, Restricao, WarehouseSlot } from "../../types";
import type { AppUser } from "../AdminUsersManagement";

type MobileTab = "endereçamento" | "lançamento" | "divergências" | "histórico" | "ai";

interface MobileShellProps {
  currentUser: AppUser;
  operator: string;
  slots: WarehouseSlot[];
  productsList: Product[];
  history: HistoricoMov[];
  divergencias: Divergencia[];
  online: boolean;
  canExecute: boolean;
  activeTab: string;
  onTabChange: (tab: MobileTab) => void;
  onUnitaryLaunch: (type: "Entrada" | "Saída", data: {
    estoque: string;
    modulo: string;
    posicao: string;
    sku: string;
    quantidade: number;
    dataChacote: string;
    galpao: Galpao;
    restricao: Restricao;
    observacao: string;
  }) => Promise<boolean>;
  onTransferPosition: (sourceId: string, destinationId: string, observation: string) => Promise<boolean>;
  onResolveDivergencia: (
    divergence: Divergencia,
    action: "sobrescrever" | "descartar",
    sku: string,
    quantity: number,
    dataChacote: string
  ) => Promise<boolean>;
  chatMessages: Array<{ sender: string; text: string }>;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendChatMessage: (messageOverride?: string) => void;
  recommendationAvailable: boolean;
  onNextRecommendation: () => void;
  onLogout: () => Promise<void>;
}

type ScanTarget = "sku" | "position";

interface BarcodeDetectorLike {
  new (options?: { formats?: string[] }): {
    detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
  };
}

interface BarcodeDetectorWindow extends Window {
  BarcodeDetector?: BarcodeDetectorLike;
}

const normalizeSku = (value: string) => {
  const clean = value.trim().toUpperCase();
  return clean.startsWith("S") ? clean.slice(1) : clean;
};

const normalizeModule = (value: string) =>
  value.trim().toUpperCase().replace(/^[RM]/, "");

const formatAddress = (slot: WarehouseSlot) =>
  `E${slot.estoque} • M${slot.modulo}${slot.posicao ? ` • ${slot.posicao}` : ""}`;

const normalizeAddressSearch = (value: string) =>
  value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const getAddressSearchVariants = (value: string): string[] => {
  const normalized = normalizeAddressSearch(value);
  if (!normalized) return [];

  const variants = new Set<string>([normalized]);
  const withoutEstoquePrefix = normalized.startsWith("E")
    ? normalized.slice(1)
    : normalized;

  variants.add(withoutEstoquePrefix);
  variants.add(withoutEstoquePrefix.replace(/M/g, ""));
  variants.add(normalized.replace(/M/g, ""));

  return Array.from(variants).filter(Boolean);
};

const formatChacoteInput = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const parseTypedChacoteDate = (value: string): number | null => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
    ? timestamp
    : null;
};

const parseChacoteDate = (value: string): number | null => {
  const clean = value.trim();
  if (!clean) return null;

  let year: number;
  let month: number;
  let day: number;

  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(clean);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const brMatch = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/.exec(clean);
    if (!brMatch) return null;

    day = Number(brMatch[1]);
    month = Number(brMatch[2]);
    year = Number(brMatch[3]);
    if (year < 100) year += 2000;
  }

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
};

export function MobileShell({
  currentUser,
  operator,
  slots,
  productsList,
  history,
  divergencias,
  online,
  canExecute,
  activeTab,
  onTabChange,
  onUnitaryLaunch,
  onTransferPosition,
  onResolveDivergencia,
  chatMessages,
  chatInput,
  onChatInputChange,
  onSendChatMessage,
  recommendationAvailable,
  onNextRecommendation,
  onLogout,
}: MobileShellProps) {
  const [search, setSearch] = useState("");
  const [searchFiltersOpen, setSearchFiltersOpen] = useState(false);
  const [searchGalpao, setSearchGalpao] = useState("");
  const [searchRestricao, setSearchRestricao] = useState("");
  const [searchObservacao, setSearchObservacao] = useState("");
  const [searchSort, setSearchSort] = useState<"address" | "chacoteAsc" | "chacoteDesc" | "qtyAsc" | "qtyDesc">("address");
  const [launchType, setLaunchType] = useState<"Entrada" | "Saída" | "Transferência">("Entrada");
  const [estoque, setEstoque] = useState("2");
  const [modulo, setModulo] = useState("");
  const [posicao, setPosicao] = useState("");
  const [sku, setSku] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [dataChacote, setDataChacote] = useState("");
  const [galpao, setGalpao] = useState<Galpao>("3");
  const [restricao, setRestricao] = useState<Restricao>("nenhuma");
  const [observacao, setObservacao] = useState("");
  const [transferObservation, setTransferObservation] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [transferSourceSearch, setTransferSourceSearch] = useState("");
  const [transferDestinationSearch, setTransferDestinationSearch] = useState("");
  const [launching, setLaunching] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const [scannerTarget, setScannerTarget] = useState<ScanTarget | null>(null);
  const [scannerError, setScannerError] = useState("");
  const [scannerSupported, setScannerSupported] = useState(true);
  const [historySearch, setHistorySearch] = useState("");
  const [historyResponsible, setHistoryResponsible] = useState("");
  const [historyType, setHistoryType] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyGalpao, setHistoryGalpao] = useState("");
  const [historyObservacao, setHistoryObservacao] = useState("");
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);

  const [selectedDivergenciaId, setSelectedDivergenciaId] = useState<string | null>(null);
  const [divergenciaResolveAction, setDivergenciaResolveAction] = useState<"sobrescrever" | "descartar">("sobrescrever");
  const [divergenciaResolveSku, setDivergenciaResolveSku] = useState("");
  const [divergenciaResolveQty, setDivergenciaResolveQty] = useState("");
  const [divergenciaResolveChacote, setDivergenciaResolveChacote] = useState("");
  const [resolvingDivergencia, setResolvingDivergencia] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);
  const scannerControlsRef = useRef<{ stop: () => void } | null>(null);

  const productMap = useMemo(
    () => new Map(productsList.map(product => [normalizeSku(product.referencia), product])),
    [productsList]
  );

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    const addressQueryVariants = getAddressSearchVariants(search);
    const galpaoFilter = searchGalpao.trim();
    const observacaoFilter = searchObservacao.trim().toLowerCase();
    const restricaoFilter = searchRestricao.trim().toLowerCase();

    const filtered = slots
      .filter(slot => slot.saldo > 0 && slot.referencia)
      .filter(slot => {
        const product = productMap.get(normalizeSku(slot.referencia));
        const addressVariants = getAddressSearchVariants(
          `E${slot.estoque}M${slot.modulo}${slot.posicao || ""}`
        );
        const matchesAddress =
          addressQueryVariants.length > 0 &&
          addressQueryVariants.some(queryVariant =>
            addressVariants.some(addressVariant =>
              addressVariant.includes(queryVariant)
            )
          );

        const matchesQuery =
          !query ||
          slot.referencia.toLowerCase().includes(query) ||
          slot.descricao.toLowerCase().includes(query) ||
          slot.modulo.toLowerCase().includes(query) ||
          slot.posicao.toLowerCase().includes(query) ||
          formatAddress(slot).toLowerCase().includes(query) ||
          matchesAddress ||
          product?.descricao.toLowerCase().includes(query);

        if (!matchesQuery) return false;
        if (galpaoFilter && String(slot.galpao || "3") !== galpaoFilter) return false;
        if (
          restricaoFilter &&
          String(slot.restricao || "nenhuma").trim().toLowerCase() !== restricaoFilter
        ) {
          return false;
        }
        if (
          observacaoFilter &&
          !String(slot.observacao || "").toLowerCase().includes(observacaoFilter)
        ) {
          return false;
        }

        return true;
      });

    return filtered
      .sort((a, b) => {
        if (searchSort === "qtyAsc") return a.saldo - b.saldo;
        if (searchSort === "qtyDesc") return b.saldo - a.saldo;

        if (searchSort === "chacoteAsc" || searchSort === "chacoteDesc") {
          const aTime = a.dataChacote ? parseChacoteDate(a.dataChacote) : null;
          const bTime = b.dataChacote ? parseChacoteDate(b.dataChacote) : null;

          // Paletes sem data devem sempre aparecer primeiro.
          // Depois deles, a ordenação segue a data escolhida.
          if (aTime === null && bTime === null) return 0;
          if (aTime === null) return -1;
          if (bTime === null) return 1;

          return searchSort === "chacoteAsc" ? aTime - bTime : bTime - aTime;
        }

        return (
          a.estoque.localeCompare(b.estoque, "pt-BR", { numeric: true }) ||
          a.modulo.localeCompare(b.modulo, "pt-BR", { numeric: true }) ||
          a.posicao.localeCompare(b.posicao, "pt-BR", { numeric: true })
        );
      })
      .slice(0, 50);
  }, [
    slots,
    search,
    productMap,
    searchGalpao,
    searchRestricao,
    searchObservacao,
    searchSort,
  ]);

  const transferSources = useMemo(() => {
    const query = transferSourceSearch.trim().toLowerCase();
    const addressQuery = normalizeAddressSearch(transferSourceSearch);

    return slots
      .filter(slot => slot.saldo > 0 && slot.referencia && slot.estoque !== "1")
      .filter(slot => {
        const address = normalizeAddressSearch(
          `E${slot.estoque}M${slot.modulo}${slot.posicao || ""}`
        );
        const formattedAddress = formatAddress(slot).toLowerCase();

        return (
          !query ||
          address.includes(addressQuery) ||
          formattedAddress.includes(query) ||
          slot.referencia.toLowerCase().includes(query) ||
          slot.descricao.toLowerCase().includes(query)
        );
      })
      .slice(0, 30);
  }, [slots, transferSourceSearch]);

  useEffect(() => {
    if (activeTab !== "lançamento" || launchType !== "Transferência") {
      setSourceId("");
      setDestinationId("");
      setTransferSourceSearch("");
      setTransferDestinationSearch("");
    }
  }, [activeTab, launchType]);

  const transferDestinations = useMemo(() => {
    const source = slots.find(slot => slot.id === sourceId);
    if (!source) return [];

    const query = transferDestinationSearch.trim().toLowerCase();
    const addressQuery = normalizeAddressSearch(transferDestinationSearch);

    return slots
      .filter(
        slot =>
          slot.id !== source.id &&
          slot.estoque === source.estoque &&
          slot.saldo === 0 &&
          slot.posicao
      )
      .filter(slot => {
        const address = normalizeAddressSearch(
          `E${slot.estoque}M${slot.modulo}${slot.posicao || ""}`
        );

        return (
          !query ||
          address.includes(addressQuery) ||
          formatAddress(slot).toLowerCase().includes(query)
        );
      })
      .slice(0, 30);
  }, [slots, sourceId, transferDestinationSearch]);

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    const responsible = historyResponsible.trim().toLowerCase();
    const observacao = historyObservacao.trim().toLowerCase();

    return history
      .slice()
      .sort((a, b) => `${b.data} ${b.hora}`.localeCompare(`${a.data} ${a.hora}`))
      .filter(row => {
        const matchesQuery =
          !query ||
          [row.referencia, row.posicao, row.modulo, row.estoque, row.tipo, row.responsavel]
            .some(value => value.toLowerCase().includes(query));

        if (!matchesQuery) return false;
        if (responsible && !row.responsavel.toLowerCase().includes(responsible)) return false;
        if (historyType && row.tipo !== historyType) return false;
        if (historyDateFrom && row.data < historyDateFrom) return false;
        if (historyDateTo && row.data > historyDateTo) return false;
        if (historyGalpao && String(row.galpao || "3") !== historyGalpao) return false;
        if (observacao && !String(row.observacao || "").toLowerCase().includes(observacao)) return false;
        return true;
      })
      .slice(0, 80);
  }, [
    history,
    historySearch,
    historyResponsible,
    historyType,
    historyDateFrom,
    historyDateTo,
    historyGalpao,
    historyObservacao,
  ]);

  const focusConsultorChat = (prompt: string) => {
    onChatInputChange(prompt);
    requestAnimationFrame(() => {
      chatContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      chatInputRef.current?.focus();
    });
  };

  const openDivergencias = useMemo(
    () => divergencias.filter(div => div.status === "Aberta"),
    [divergencias]
  );

  const groupedOpenDivergencias = useMemo(() => {
    const groups = new Map<string, Divergencia[]>();

    openDivergencias.forEach(div => {
      const key = `${div.estoque}|${div.modulo}|${div.posicao || ""}`;
      const group = groups.get(key);

      if (group) {
        group.push(div);
      } else {
        groups.set(key, [div]);
      }
    });

    return Array.from(groups.values()).sort((a, b) => {
      const firstA = a[0];
      const firstB = b[0];

      return (
        firstA.estoque.localeCompare(firstB.estoque, "pt-BR", { numeric: true }) ||
        firstA.modulo.localeCompare(firstB.modulo, "pt-BR", { numeric: true }) ||
        (firstA.posicao || "").localeCompare(firstB.posicao || "", "pt-BR", { numeric: true })
      );
    });
  }, [openDivergencias]);

  const selectedDivergencia = selectedDivergenciaId
    ? divergencias.find(div => div.id === selectedDivergenciaId) ?? null
    : null;

  const openDivergenciaCorrection = (div: Divergencia) => {
    setSelectedDivergenciaId(div.id);
    setDivergenciaResolveAction("sobrescrever");
    setDivergenciaResolveSku(div.refNova || (div.refAtual === "Vazio" ? "" : div.refAtual) || "");
    setDivergenciaResolveQty(String(Math.abs(div.movimentacao)));
    setDivergenciaResolveChacote(div.dataChacote || "");
  };

  const closeDivergenciaCorrection = () => {
    if (resolvingDivergencia) return;
    setSelectedDivergenciaId(null);
  };

  const submitDivergenciaCorrection = async () => {
    if (!selectedDivergencia || !canExecute || resolvingDivergencia) return;

    const quantity = Number(divergenciaResolveQty);

    if (
      divergenciaResolveAction === "sobrescrever" &&
      divergenciaResolveChacote &&
      parseTypedChacoteDate(divergenciaResolveChacote) === null
    ) {
      alert("Informe o Chacote no formato DD/MM/AAAA.");
      return;
    }

    if (
      divergenciaResolveAction === "sobrescrever" &&
      (!Number.isFinite(quantity) || quantity < 0)
    ) {
      alert("Informe um saldo físico válido.");
      return;
    }

    setResolvingDivergencia(true);

    try {
      const saved = await onResolveDivergencia(
        selectedDivergencia,
        divergenciaResolveAction,
        divergenciaResolveSku,
        quantity,
        divergenciaResolveChacote
      );

      if (saved) {
        setSelectedDivergenciaId(null);
      }
    } finally {
      setResolvingDivergencia(false);
    }
  };

  const selectedSkuProduct = productMap.get(normalizeSku(sku));
  const selectedLaunchSlot = useMemo(
    () =>
      slots.find(
        slot =>
          slot.estoque === estoque &&
          slot.modulo === normalizeModule(modulo) &&
          slot.posicao === (estoque === "1" ? "" : posicao.toUpperCase())
      ) ?? null,
    [slots, estoque, modulo, posicao]
  );

  const stopScanner = () => {
    if (scannerFrameRef.current !== null) {
      cancelAnimationFrame(scannerFrameRef.current);
      scannerFrameRef.current = null;
    }

    scannerControlsRef.current?.stop();
    scannerControlsRef.current = null;

    scannerStreamRef.current?.getTracks().forEach(track => track.stop());
    scannerStreamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setScannerTarget(null);
  };

  useEffect(() => {
    return () => stopScanner();
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport) return;

    const updateKeyboardState = () => {
      const keyboardHeight = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );

      setKeyboardOpen(keyboardHeight > 120);

      if (keyboardHeight > 120) {
        window.setTimeout(() => {
          const activeElement = document.activeElement;
          if (
            activeElement instanceof HTMLInputElement ||
            activeElement instanceof HTMLTextAreaElement ||
            activeElement instanceof HTMLSelectElement
          ) {
            activeElement.scrollIntoView({
              block: "center",
              inline: "nearest",
              behavior: "smooth",
            });
          }
        }, 80);
      }
    };

    updateKeyboardState();
    viewport.addEventListener("resize", updateKeyboardState);
    viewport.addEventListener("scroll", updateKeyboardState);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardState);
      viewport.removeEventListener("scroll", updateKeyboardState);
    };
  }, []);

  useEffect(() => {
    if (!scannerTarget) return;

    let cancelled = false;

    const applyScanValue = (value: string) => {
      const cleanValue = value.trim();
      if (!cleanValue) return;

      if (scannerTarget === "sku") {
        setSku(normalizeSku(cleanValue));
      } else {
        const normalized = cleanValue.toUpperCase();
        const compactScanned = normalized.replace(/[^A-Z0-9]/g, "");
        const matchingSlot = slots.find(slot => {
          const compactId = slot.id.toUpperCase().replace(/[^A-Z0-9]/g, "");
          const compactAddress = `E${slot.estoque}M${slot.modulo}${slot.posicao || ""}`.toUpperCase().replace(/[^A-Z0-9]/g, "");
          return compactId === compactScanned || compactAddress === compactScanned;
        });

        if (matchingSlot) {
          setEstoque(matchingSlot.estoque);
          setModulo(normalizeModule(matchingSlot.modulo));
          setPosicao(matchingSlot.posicao);
        } else {
          const compactAddress = normalized.replace(/[^A-Z0-9]/g, "");
          const physicalAddressMatch = compactAddress.match(/^E?([23])M?(\d{1,3})([A-Z]\d{0,2})$/);
          const e1AddressMatch = compactAddress.match(/^E?1M?(\d{1,3})$/);

          if (physicalAddressMatch) {
            setEstoque(physicalAddressMatch[1]);
            setModulo(normalizeModule(physicalAddressMatch[2]));
            setPosicao(physicalAddressMatch[3]);
          } else if (e1AddressMatch) {
            setEstoque("1");
            setModulo(normalizeModule(e1AddressMatch[1]));
            setPosicao("");
          } else {
            setSearch(cleanValue);
          }
        }
      }

      stopScanner();
    };

    const start = async () => {
      setScannerError("");
      setScannerSupported(true);

      if (!navigator.mediaDevices?.getUserMedia) {
        setScannerSupported(false);
        setScannerError("A câmera não está disponível neste navegador ou contexto.");
        return;
      }

      try {
        const BarcodeDetectorCtor = (window as BarcodeDetectorWindow).BarcodeDetector;

        if (BarcodeDetectorCtor) {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });

          if (cancelled) {
            stream.getTracks().forEach(track => track.stop());
            return;
          }

          scannerStreamRef.current = stream;

          if (!videoRef.current) return;
          videoRef.current.srcObject = stream;
          await videoRef.current.play();

          const detector = new BarcodeDetectorCtor({
            formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "itf"],
          });

          const scan = async () => {
            if (cancelled || !videoRef.current) return;

            try {
              const results = await detector.detect(videoRef.current);
              const value = results.find(result => result.rawValue?.trim())?.rawValue?.trim();
              if (value) {
                applyScanValue(value);
                return;
              }
            } catch {
              // Continue scanning; individual camera frames can fail to decode.
            }

            scannerFrameRef.current = requestAnimationFrame(scan);
          };

          scannerFrameRef.current = requestAnimationFrame(scan);
          return;
        }

        // iOS Safari and other browsers without BarcodeDetector use ZXing.
        // The decoder is loaded only when needed, keeping the normal bundle unchanged.
        setScannerError("Preparando o leitor de QR Code/código de barras…");

        const zxingUrl = "https://esm.sh/@zxing/browser@0.2.1?bundle";
        const zxing = await import(/* @vite-ignore */ zxingUrl);
        if (cancelled || !videoRef.current) return;

        const reader = new zxing.BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result: { getText?: () => string } | undefined) => {
            if (cancelled || !result) return;
            const value = result.getText?.() || "";
            if (value.trim()) applyScanValue(value);
          },
        );

        scannerControlsRef.current = controls;
        setScannerError("");
      } catch (error) {
        console.error("Falha ao iniciar scanner:", error);
        setScannerSupported(false);
        setScannerError(
          "Não foi possível iniciar o leitor. Verifique a permissão da câmera e a conexão com a internet na primeira utilização."
        );
      }
    };

    void start();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scannerTarget, slots]);

  const handleLaunch = async () => {
    if (!canExecute || launching) return;

    const qty = Number(quantidade);
    if (!Number.isInteger(qty) || qty <= 0) {
      window.alert("Informe uma quantidade inteira maior que zero.");
      return;
    }

    if (!sku.trim()) {
      window.alert("Informe o SKU ou use o scanner.");
      return;
    }

    if (dataChacote && parseTypedChacoteDate(dataChacote) === null) {
      window.alert("Informe o Chacote no formato DD/MM/AAAA.");
      return;
    }

    if (launchType === "Entrada" && galpao === "12") {
      setRestricao("autorizacao");
    }

    setLaunching(true);

    try {
      const effectiveRestricao =
        launchType === "Entrada" && galpao === "12" ? "autorizacao" : restricao;

      const success = await onUnitaryLaunch(launchType as "Entrada" | "Saída", {
        estoque,
        modulo,
        posicao,
        sku: normalizeSku(sku),
        quantidade: qty,
        dataChacote,
        galpao,
        restricao: effectiveRestricao,
        observacao,
      });

      if (success) {
        setSku("");
        setQuantidade("");
        setDataChacote("");
        setGalpao("3");
        setRestricao("nenhuma");
        setObservacao("");
      }
    } finally {
      setLaunching(false);
    }
  };

  const handleTransfer = async () => {
    if (!canExecute || launching) return;

    if (!sourceId || !destinationId) {
      window.alert("Selecione a posição de origem e a posição de destino.");
      return;
    }

    setLaunching(true);

    try {
      const success = await onTransferPosition(sourceId, destinationId, transferObservation);
      if (success) {
        setSourceId("");
        setDestinationId("");
        setTransferObservation("");
      }
    } finally {
      setLaunching(false);
    }
  };

  const navItems: Array<{ id: MobileTab; label: string; icon: typeof Search; badge?: number }> = [
    { id: "endereçamento", label: "Pesquisa", icon: Search },
    { id: "lançamento", label: "Lançar", icon: Package },
    { id: "divergências", label: "Divergências", icon: AlertOctagon, badge: openDivergencias.length },
    { id: "histórico", label: "Histórico", icon: History },
    { id: "ai", label: "IA", icon: Bot },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] w-full flex-col bg-slate-50 pt-[env(safe-area-inset-top)] text-slate-800">
      <header className="shrink-0 border-b border-slate-200 bg-slate-950 text-white">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-blue-300">
              Porto Brasil
            </div>
            <div className="truncate text-sm font-bold">
              {currentUser.name || operator}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                online ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
              }`}
              title={online ? "Conectado" : "Sem conexão"}
            >
              {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? "ONLINE" : "OFFLINE"}
            </div>

            <button
              type="button"
              onClick={() => void onLogout()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-slate-200"
              aria-label="Sair"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4 ${
          keyboardOpen ? "pb-6" : "pb-20"
        }`}
      >
        {activeTab === "endereçamento" && (
          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-black tracking-tight">Pesquisa</h1>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Encontre rapidamente produto, saldo e posição.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="SKU, descrição ou endereço"
                className="h-14 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-12 text-base font-semibold shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                inputMode="search"
              />
              <button
                type="button"
                onClick={() => setScannerTarget("sku")}
                className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700"
                aria-label="Escanear"
              >
                <Camera className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setSearchFiltersOpen(value => !value)}
                className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black ${
                  searchFiltersOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <Filter className="h-4 w-4" />
                Filtros
              </button>
              <span className="text-[10px] font-bold text-slate-400">{searchResults.length} resultado(s)</span>
            </div>

            {searchFiltersOpen && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Refinar pesquisa</div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Galpão
                    <select
                      value={searchGalpao}
                      onChange={event => setSearchGalpao(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-2 text-base font-bold text-slate-700"
                    >
                      <option value="">Todos</option>
                      <option value="3">Galpão 3</option>
                      <option value="12">Galpão 12</option>
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Restrição
                    <select
                      value={searchRestricao}
                      onChange={event => setSearchRestricao(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-2 text-base font-bold text-slate-700"
                    >
                      <option value="">Todas</option>
                      <option value="nenhuma">Nenhuma</option>
                      <option value="teste">Teste</option>
                      <option value="autorizacao">Solicitar autorização</option>
                      <option value="outra">Outro motivo</option>
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Observação
                    <input
                      type="text"
                      value={searchObservacao}
                      onChange={event => setSearchObservacao(event.target.value)}
                      placeholder="Buscar observação"
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-base font-bold text-slate-700"
                    />
                  </label>
                </div>

                <label className="mt-2 block text-[10px] font-black uppercase text-slate-400">
                  Ordenar resultados
                  <select
                    value={searchSort}
                    onChange={event => setSearchSort(event.target.value as typeof searchSort)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-bold text-slate-700 outline-none"
                  >
                    <option value="address">Endereço: E → M → posição</option>
                    <option value="chacoteAsc">Chacote: mais antigo → mais novo</option>
                    <option value="chacoteDesc">Chacote: mais novo → mais antigo</option>
                    <option value="qtyAsc">Quantidade: menor → maior</option>
                    <option value="qtyDesc">Quantidade: maior → menor</option>
                  </select>
                </label>

                <button type="button"
                  onClick={() => {
                    setSearchGalpao("");
                    setSearchRestricao("");
                    setSearchObservacao("");
                    setSearchSort("address");
                  }}
                  className="mt-3 text-[10px] font-black uppercase text-blue-600"
                >
                  Limpar filtros
                </button>
              </div>
            )}

            <div className="space-y-2">
              {searchResults.map(slot => {
                const product = productMap.get(normalizeSku(slot.referencia));
                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => {
                      setSearch(slot.referencia);
                      onTabChange("endereçamento");
                    }}
                    className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-black text-blue-700">
                          {slot.referencia}
                        </div>
                        <div className="mt-0.5 truncate text-sm font-bold text-slate-800">
                          {slot.descricao || product?.descricao || "Produto"}
                        </div>
                      </div>
                      <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-300" />
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-xl bg-slate-50 p-2.5">
                        <span className="block text-[9px] font-black uppercase text-slate-400">Endereço</span>
                        <span className="mt-1 block font-mono font-black text-slate-700">
                          {formatAddress(slot)}
                        </span>
                      </div>
                      <div className="rounded-xl bg-blue-50 p-2.5">
                        <span className="block text-[9px] font-black uppercase text-blue-400">Saldo</span>
                        <span className="mt-1 block font-black text-blue-700">
                          {slot.saldo.toLocaleString("pt-BR")} pçs
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${
                        slot.galpao === "12"
                          ? "bg-red-50 text-red-700"
                          : "bg-slate-100 text-slate-600"
                      }`}>
                        GALPÃO {slot.galpao || "3"}
                      </span>
                      {slot.galpao === "12" && (
                        <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">
                          🔴 SOLICITAR AUTORIZAÇÃO
                        </span>
                      )}
                      {slot.galpao !== "12" && slot.restricao === "teste" && (
                        <span className="rounded-full bg-orange-50 px-2 py-1 text-[9px] font-black uppercase text-orange-700">
                          🟠 TESTE — NÃO SEPARAR
                        </span>
                      )}
                      {slot.galpao !== "12" && slot.restricao === "autorizacao" && (
                        <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">
                          🔴 SOLICITAR AUTORIZAÇÃO
                        </span>
                      )}
                      {slot.galpao !== "12" && slot.restricao === "outra" && (
                        <span className="rounded-full bg-purple-50 px-2 py-1 text-[9px] font-black uppercase text-purple-700">
                          🟣 OUTRA RESTRIÇÃO
                        </span>
                      )}
                    </div>

                    {slot.dataChacote && (
                      <div className="mt-2 text-[10px] font-semibold text-slate-400">
                        Chacote: {slot.dataChacote}
                      </div>
                    )}
                    {slot.observacao && (
                      <div className="mt-1 text-[10px] font-medium text-slate-500">
                        Obs.: {slot.observacao}
                      </div>
                    )}
                  </button>
                );
              })}

              {searchResults.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
                  <Search className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-bold text-slate-600">Nenhum resultado</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Tente outro SKU, descrição ou endereço.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "lançamento" && (
          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-black tracking-tight">Lançamento</h1>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Uma movimentação física por vez.
              </p>
            </div>

            {!canExecute && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-800">
                Perfil Visualizador: você pode consultar esta área, mas não pode executar operações.
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              {(["Entrada", "Saída", "Transferência"] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setLaunchType(type)}
                  className={`min-h-12 rounded-xl border text-xs font-black transition ${
                    launchType === type
                      ? type === "Entrada"
                        ? "border-emerald-600 bg-emerald-600 text-white"
                        : type === "Saída"
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-blue-600 bg-blue-600 text-white"
                      : type === "Entrada"
                        ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                        : type === "Saída"
                          ? "border-red-100 bg-red-50 text-red-700"
                          : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            {launchType !== "Transferência" ? (
              <>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Produto
                    </span>
                    <button
                      type="button"
                      onClick={() => setScannerTarget("sku")}
                      className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"
                    >
                      <Camera className="h-4 w-4" />
                      Escanear
                    </button>
                  </div>

                  <input
                    value={sku}
                    onChange={event => setSku(event.target.value)}
                    placeholder="SKU"
                    className="h-13 w-full rounded-xl border border-slate-200 px-4 text-base font-black uppercase outline-none focus:border-blue-500"
                    inputMode="text"
                  />

                  {selectedSkuProduct && (
                    <div className="mt-2 rounded-xl bg-slate-50 p-3 text-xs">
                      <div className="font-black text-slate-800">{selectedSkuProduct.descricao}</div>
                      <div className="mt-1 text-slate-500">
                        Paletização: {selectedSkuProduct.paletizacao || "não definida"} pçs
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Endereço
                    </span>
                    <button
                      type="button"
                      onClick={() => setScannerTarget("position")}
                      className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-700"
                    >
                      <Camera className="h-4 w-4" />
                      QR / código
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={estoque}
                      onChange={event => setEstoque(event.target.value)}
                      className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-base font-black outline-none"
                    >
                      <option value="1">E1</option>
                      <option value="2">E2</option>
                      <option value="3">E3</option>
                    </select>

                    <input
                      value={modulo}
                      onChange={event => setModulo(event.target.value.replace(/\D/g, ""))}
                      placeholder="Módulo"
                      className="h-12 rounded-xl border border-slate-200 px-3 text-base font-black outline-none"
                      inputMode="numeric"
                    />

                    <input
                      value={posicao}
                      onChange={event => setPosicao(event.target.value.toUpperCase())}
                      placeholder="Pos."
                      className="h-12 rounded-xl border border-slate-200 px-3 text-base font-black uppercase outline-none"
                    />
                  </div>

                  <p className="mt-2 text-[10px] font-medium text-slate-400">
                    Você pode pesquisar/selecionar o endereço e, nas próximas versões, receber uma sugestão automática da IA.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Quantidade
                    </span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={quantidade}
                      onChange={event => setQuantidade(event.target.value)}
                      placeholder="0"
                      className="mt-2 h-12 w-full border-0 p-0 text-2xl font-black outline-none"
                      inputMode="numeric"
                    />
                    <span className="text-[10px] font-bold text-slate-400">peças inteiras</span>
                  </label>

                  <label className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Data chacote
                    </span>
                    <input
                      type="text"
                      value={dataChacote}
                      onChange={event => setDataChacote(formatChacoteInput(event.target.value))}
                      placeholder="DD/MM/AAAA"
                      inputMode="numeric"
                      maxLength={10}
                      className="mt-3 h-10 w-full rounded-lg border border-slate-200 px-2 text-base font-bold outline-none"
                    />
                    <span className="mt-1 block text-[9px] font-medium text-slate-400">
                      Referência FIFO registrada na posição.
                    </span>
                  </label>
                </div>

                {launchType === "Entrada" ? (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-2 gap-3">
                      <label>
                        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                          Galpão
                        </span>
                        <select
                          value={galpao}
                          onChange={event => {
                            const value = event.target.value as Galpao;
                            setGalpao(value);
                            if (value === "12") setRestricao("autorizacao");
                          }}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-black outline-none"
                        >
                          <option value="3">Galpão 3</option>
                          <option value="12">Galpão 12</option>
                        </select>
                      </label>

                      <label>
                        <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                          Restrição
                        </span>
                        <select
                          value={galpao === "12" ? "autorizacao" : restricao}
                          onChange={event => setRestricao(event.target.value as Restricao)}
                          disabled={galpao === "12"}
                          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-black outline-none disabled:bg-slate-100"
                        >
                          <option value="nenhuma">Nenhuma</option>
                          <option value="teste">Teste — não separar</option>
                          <option value="autorizacao">Solicitar autorização</option>
                          <option value="outra">Outra restrição</option>
                        </select>
                      </label>
                    </div>

                    {galpao === "12" && (
                      <div className="rounded-xl bg-red-50 px-3 py-2 text-xs font-black uppercase text-red-700">
                        GALPÃO 12 — 🔴 SOLICITAR AUTORIZAÇÃO
                      </div>
                    )}

                    {galpao !== "12" && restricao === "teste" && (
                      <div className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-black uppercase text-orange-700">
                        🟠 TESTE — NÃO SEPARAR
                      </div>
                    )}

                    {galpao !== "12" && restricao === "outra" && (
                      <div className="rounded-xl bg-purple-50 px-3 py-2 text-xs font-black uppercase text-purple-700">
                        🟣 OUTRA RESTRIÇÃO
                      </div>
                    )}

                    <label className="block">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Observação
                      </span>
                      <textarea
                        value={observacao}
                        onChange={event => setObservacao(event.target.value)}
                        placeholder="Observação do palete ou movimentação"
                        rows={2}
                        className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-base font-semibold outline-none"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap gap-1.5">
                      {selectedLaunchSlot?.galpao === "12" && (
                        <>
                          <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">GALPÃO 12</span>
                          <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">🔴 SOLICITAR AUTORIZAÇÃO</span>
                        </>
                      )}
                      {selectedLaunchSlot?.galpao !== "12" && selectedLaunchSlot?.restricao === "teste" && (
                        <span className="rounded-full bg-orange-50 px-2 py-1 text-[9px] font-black uppercase text-orange-700">🟠 TESTE — NÃO SEPARAR</span>
                      )}
                      {selectedLaunchSlot?.galpao !== "12" && selectedLaunchSlot?.restricao === "autorizacao" && (
                        <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">🔴 SOLICITAR AUTORIZAÇÃO</span>
                      )}
                      {selectedLaunchSlot?.galpao !== "12" && selectedLaunchSlot?.restricao === "outra" && (
                        <span className="rounded-full bg-purple-50 px-2 py-1 text-[9px] font-black uppercase text-purple-700">🟣 OUTRA RESTRIÇÃO</span>
                      )}
                      {!selectedLaunchSlot && (
                        <span className="text-xs font-semibold text-slate-400">Selecione um endereço para visualizar a classificação do palete.</span>
                      )}
                    </div>

                    <label className="mt-3 block">
                      <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Observação da movimentação
                      </span>
                      <textarea
                        value={observacao}
                        onChange={event => setObservacao(event.target.value)}
                        placeholder="Motivo ou autorização da saída"
                        rows={2}
                        className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-base font-semibold outline-none"
                      />
                    </label>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!canExecute || launching || !online}
                  onClick={() => void handleLaunch()}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-blue-600/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {launching ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                  {online ? `Confirmar ${launchType}` : "Operação exige conexão"}
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs font-semibold text-blue-900">
                  Transferência Mobile move o estoque inteiro de uma posição para outra.
                  SKU, saldo e data de chacote são preservados.
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Origem</span>
                    {sourceId && (
                      <button
                        type="button"
                        onClick={() => {
                          setSourceId("");
                          setDestinationId("");
                          setTransferSourceSearch("");
                          setTransferDestinationSearch("");
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black uppercase text-slate-600"
                        aria-label="Cancelar origem selecionada"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancelar
                      </button>
                    )}
                  </div>
                  <input value={transferSourceSearch}
                    onChange={event => setTransferSourceSearch(event.target.value)}
                    placeholder="Buscar posição, SKU ou descrição"
                    disabled={Boolean(sourceId)}
                    className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-semibold outline-none focus:border-blue-500 disabled:bg-slate-100"
                  />
                  {sourceId ? (() => {
                    const selected = slots.find(slot => slot.id === sourceId);
                    return selected ? (
                      <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <div className="font-mono text-sm font-black text-blue-800">{formatAddress(selected)}</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="text-xs font-bold text-slate-700">{selected.referencia} • {selected.saldo.toLocaleString("pt-BR")} pçs</div>
                          <button
                            type="button"
                            onClick={() => {
                              setSourceId("");
                              setDestinationId("");
                              setTransferDestinationSearch("");
                            }}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200"
                            aria-label="Remover origem"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selected.galpao === "12" && (
                            <>
                              <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">GALPÃO 12</span>
                              <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">🔴 SOLICITAR AUTORIZAÇÃO</span>
                            </>
                          )}
                          {selected.galpao !== "12" && selected.restricao === "teste" && (
                            <span className="rounded-full bg-orange-50 px-2 py-1 text-[9px] font-black uppercase text-orange-700">🟠 TESTE — NÃO SEPARAR</span>
                          )}
                          {selected.galpao !== "12" && selected.restricao === "autorizacao" && (
                            <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">🔴 SOLICITAR AUTORIZAÇÃO</span>
                          )}
                          {selected.galpao !== "12" && selected.restricao === "outra" && (
                            <span className="rounded-full bg-purple-50 px-2 py-1 text-[9px] font-black uppercase text-purple-700">🟣 OUTRA RESTRIÇÃO</span>
                          )}
                        </div>
                      </div>
                    ) : null;
                  })() : (
                    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                      {transferSources.map(slot => (
                        <button key={slot.id} type="button"
                          onClick={() => { setSourceId(slot.id); setDestinationId(""); setTransferSourceSearch(""); setTransferDestinationSearch(""); }}
                          className="w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-left active:bg-blue-50"
                        >
                          <div className="font-mono text-xs font-black text-slate-800">{formatAddress(slot)}</div>
                          <div className="mt-1 text-[10px] font-semibold text-slate-500">{slot.referencia} • {slot.saldo.toLocaleString("pt-BR")} pçs</div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {slot.galpao === "12" && (
                              <>
                                <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">GALPÃO 12</span>
                                <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">🔴 SOLICITAR AUTORIZAÇÃO</span>
                              </>
                            )}
                            {slot.galpao !== "12" && slot.restricao === "teste" && (
                              <span className="rounded-full bg-orange-50 px-2 py-1 text-[9px] font-black uppercase text-orange-700">🟠 TESTE — NÃO SEPARAR</span>
                            )}
                            {slot.galpao !== "12" && slot.restricao === "autorizacao" && (
                              <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">🔴 SOLICITAR AUTORIZAÇÃO</span>
                            )}
                            {slot.galpao !== "12" && slot.restricao === "outra" && (
                              <span className="rounded-full bg-purple-50 px-2 py-1 text-[9px] font-black uppercase text-purple-700">🟣 OUTRA RESTRIÇÃO</span>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">Destino</span>
                  <input value={transferDestinationSearch}
                    onChange={event => setTransferDestinationSearch(event.target.value)}
                    placeholder={sourceId ? "Buscar posição vazia" : "Selecione a origem primeiro"}
                    disabled={!sourceId}
                    className="mt-2 h-12 w-full rounded-xl border border-slate-200 px-3 text-base font-semibold outline-none focus:border-blue-500 disabled:bg-slate-100"
                  />
                  {destinationId ? (() => {
                    const selected = slots.find(slot => slot.id === destinationId);
                    return selected ? (
                      <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <div className="font-mono text-sm font-black text-emerald-800">{formatAddress(selected)}</div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div className="text-xs font-bold text-emerald-700">Posição vazia selecionada</div>
                          <button
                            type="button"
                            onClick={() => setDestinationId("")}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-200"
                            aria-label="Remover destino"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ) : null;
                  })() : (
                    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                      {transferDestinations.map(slot => (
                        <button key={slot.id} type="button"
                          onClick={() => { setDestinationId(slot.id); setTransferDestinationSearch(""); }}
                          className="w-full rounded-xl border border-slate-100 bg-slate-50 p-3 text-left active:bg-emerald-50"
                        >
                          <div className="font-mono text-xs font-black text-slate-800">{formatAddress(slot)}</div>
                          <div className="mt-1 text-[10px] font-semibold text-emerald-700">Posição vazia</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <label className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                    Observação da transferência
                  </span>
                  <textarea
                    value={transferObservation}
                    onChange={event => setTransferObservation(event.target.value)}
                    placeholder="Motivo ou observação da transferência"
                    rows={2}
                    className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-base font-semibold outline-none"
                  />
                </label>

                <button
                  type="button"
                  disabled={!canExecute || launching || !online}
                  onClick={() => void handleTransfer()}
                  className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-indigo-600/20 disabled:opacity-40"
                >
                  {launching ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowLeftRight className="h-5 w-5" />}
                  Confirmar transferência
                </button>
              </div>
            )}
          </section>
        )}

        {activeTab === "divergências" && (
          <section className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <h1 className="text-xl font-black tracking-tight">Divergências</h1>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  Priorize as ocorrências abertas.
                </p>
              </div>
              <div className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-black text-red-700">
                {openDivergencias.length} abertas
              </div>
            </div>

            {groupedOpenDivergencias.map(group => {
              const div = group[0];
              const divergenceCount = group.length;

              return (
                <article key={`${div.estoque}-${div.modulo}-${div.posicao || "RUA"}`} className="rounded-2xl border border-red-100 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-black text-red-700">{div.id}</div>
                      <div className="mt-1 text-sm font-black text-slate-800">{div.tipoDivergencia}</div>
                    </div>
                  <span className="rounded-full bg-red-50 px-2 py-1 text-[9px] font-black uppercase text-red-700">
                    Aberta
                  </span>
                </div>

                {divergenceCount > 1 && (
                  <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-black text-red-700">
                    {divergenceCount} divergências abertas nesta posição
                  </div>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="block text-[9px] font-black uppercase text-slate-400">Local</span>
                    <span className="mt-1 block font-mono font-black text-slate-700">
                      E{div.estoque} / M{div.modulo} / {div.posicao || "Rua"}
                    </span>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <span className="block text-[9px] font-black uppercase text-slate-400">Movimento</span>
                    <span className="mt-1 block font-black text-slate-700">
                      {Math.abs(div.movimentacao).toLocaleString("pt-BR")} pçs
                    </span>
                  </div>
                </div>

                <div className="mt-3 text-xs font-medium leading-relaxed text-slate-500">
                  {div.observacao || "Divergência gerada durante a operação."}
                </div>

                {canExecute && (
                  <button
                    type="button"
                    onClick={() => openDivergenciaCorrection(div)}
                    className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white shadow-sm active:bg-red-700"
                  >
                    Corrigir divergência
                  </button>
                )}
              </article>
              );
            })}

            {selectedDivergencia && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-3">
                <div className="max-h-[88vh] w-full overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-black text-red-700">
                        {selectedDivergencia.id}
                      </div>
                      <h2 className="mt-1 text-lg font-black text-slate-900">
                        Corrigir divergência
                      </h2>
                      <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
                        A correção é aplicada ao endereço físico e encerra as divergências abertas
                        daquele mesmo endereço.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={resolvingDivergencia}
                      onClick={closeDivergenciaCorrection}
                      className="rounded-full bg-slate-100 p-2 text-slate-500 disabled:opacity-40"
                      aria-label="Fechar"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <span className="block text-[9px] font-black uppercase text-slate-400">Local</span>
                      <span className="mt-1 block font-mono text-xs font-black text-slate-800">
                        E{selectedDivergencia.estoque} / M{selectedDivergencia.modulo} / {selectedDivergencia.posicao || "Rua"}
                      </span>
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <span className="block text-[9px] font-black uppercase text-slate-400">Movimento</span>
                      <span className="mt-1 block text-xs font-black text-slate-800">
                        {Math.abs(selectedDivergencia.movimentacao).toLocaleString("pt-BR")} pçs
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 rounded-xl border border-red-100 bg-red-50 p-3">
                    <div className="text-[9px] font-black uppercase text-red-500">Motivo</div>
                    <div className="mt-1 text-xs font-bold leading-relaxed text-red-800">
                      {selectedDivergencia.tipoDivergencia}
                    </div>
                    {selectedDivergencia.observacao && (
                      <div className="mt-2 text-[10px] leading-relaxed text-red-700">
                        {selectedDivergencia.observacao}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                      Ação corretora
                    </div>

                    <button
                      type="button"
                      disabled={resolvingDivergencia}
                      onClick={() => setDivergenciaResolveAction("sobrescrever")}
                      className={`w-full rounded-xl border p-3 text-left ${
                        divergenciaResolveAction === "sobrescrever"
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="text-xs font-black text-slate-800">
                        Sobrescrever endereço
                      </div>
                      <div className="mt-1 text-[10px] font-medium leading-relaxed text-slate-500">
                        Registrar o SKU e o saldo que foram confirmados fisicamente no local.
                      </div>
                    </button>

                    <button
                      type="button"
                      disabled={resolvingDivergencia}
                      onClick={() => setDivergenciaResolveAction("descartar")}
                      className={`w-full rounded-xl border p-3 text-left ${
                        divergenciaResolveAction === "descartar"
                          ? "border-amber-300 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="text-xs font-black text-slate-800">
                        Zerar endereço
                      </div>
                      <div className="mt-1 text-[10px] font-medium leading-relaxed text-slate-500">
                        Confirmar fisicamente que a posição está vazia.
                      </div>
                    </button>
                  </div>

                  {divergenciaResolveAction === "sobrescrever" && (
                    <div className="mt-4 space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-[9px] font-black uppercase text-slate-500">
                          SKU físico *
                        </span>
                        <input
                          type="text"
                          value={divergenciaResolveSku}
                          onChange={event => setDivergenciaResolveSku(event.target.value)}
                          disabled={resolvingDivergencia}
                          placeholder="Ex.: 601401G"
                          className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-black uppercase text-slate-800 outline-none focus:border-blue-400"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[9px] font-black uppercase text-slate-500">
                          Saldo físico *
                        </span>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={divergenciaResolveQty}
                          onChange={event => setDivergenciaResolveQty(event.target.value)}
                          disabled={resolvingDivergencia}
                          placeholder="Ex.: 325"
                          className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-black text-slate-800 outline-none focus:border-blue-400"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[9px] font-black uppercase text-slate-500">
                          Data do chacote
                        </span>
                        <input
                          type="text"
                          value={divergenciaResolveChacote}
                          onChange={event => setDivergenciaResolveChacote(formatChacoteInput(event.target.value))}
                          disabled={resolvingDivergencia}
                          placeholder="DD/MM/AAAA"
                          inputMode="numeric"
                          maxLength={10}
                          className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-bold text-slate-800 outline-none focus:border-blue-400"
                        />
                      </label>
                    </div>
                  )}

                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      disabled={resolvingDivergencia}
                      onClick={closeDivergenciaCorrection}
                      className="min-h-12 flex-1 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase text-slate-600 disabled:opacity-40"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={resolvingDivergencia}
                      onClick={() => void submitDivergenciaCorrection()}
                      className="min-h-12 flex-1 rounded-xl bg-red-600 text-xs font-black uppercase text-white shadow-sm disabled:opacity-40"
                    >
                      {resolvingDivergencia ? "Salvando..." : "Confirmar correção"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {openDivergencias.length === 0 && (
              <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50 p-8 text-center">
                <Check className="mx-auto h-8 w-8 text-emerald-500" />
                <p className="mt-2 text-sm font-black text-emerald-800">Nenhuma divergência aberta.</p>
              </div>
            )}
          </section>
        )}

        {activeTab === "histórico" && (
          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-black tracking-tight">Histórico</h1>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Consulte as movimentações recentes.
              </p>
            </div>

            <input
              value={historySearch}
              onChange={event => setHistorySearch(event.target.value)}
              placeholder="Filtrar SKU, posição, tipo ou responsável"
              className="h-13 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base font-semibold outline-none focus:border-blue-500"
            />

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setHistoryFiltersOpen(value => !value)}
                className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black ${
                  historyFiltersOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"
                }`}
              >
                <Filter className="h-4 w-4" /> Filtros
              </button>
              <span className="text-[10px] font-bold text-slate-400">{filteredHistory.length} movimentação(ões)</span>
            </div>

            {historyFiltersOpen && (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Responsável
                    <input value={historyResponsible} onChange={event => setHistoryResponsible(event.target.value)}
                      placeholder="Nome" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-base font-bold text-slate-700" />
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Tipo
                    <select value={historyType} onChange={event => setHistoryType(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-2 text-base font-bold text-slate-700">
                      <option value="">Todos</option><option value="Entrada">Entrada</option><option value="Saída">Saída</option>
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Data desde
                    <input type="date" value={historyDateFrom} onChange={event => setHistoryDateFrom(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-2 text-base font-bold text-slate-700" />
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Data até
                    <input type="date" value={historyDateTo} onChange={event => setHistoryDateTo(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-2 text-base font-bold text-slate-700" />
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Galpão
                    <select
                      value={historyGalpao}
                      onChange={event => setHistoryGalpao(event.target.value)}
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-2 text-base font-bold text-slate-700"
                    >
                      <option value="">Todos</option>
                      <option value="3">Galpão 3</option>
                      <option value="12">Galpão 12</option>
                    </select>
                  </label>
                  <label className="text-[10px] font-black uppercase text-slate-400">
                    Observação
                    <input
                      type="text"
                      value={historyObservacao}
                      onChange={event => setHistoryObservacao(event.target.value)}
                      placeholder="Buscar observação"
                      className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-base font-bold text-slate-700"
                    />
                  </label>
                </div>
                <button type="button"
                  onClick={() => {
                    setHistoryResponsible("");
                    setHistoryType("");
                    setHistoryDateFrom("");
                    setHistoryDateTo("");
                    setHistoryGalpao("");
                    setHistoryObservacao("");
                  }}
                  className="mt-3 text-[10px] font-black uppercase text-blue-600"
                >
                  Limpar filtros
                </button>
              </div>
            )}

            <div className="space-y-2">
              {filteredHistory.map((row, index) => (
                <article key={`${row.id}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm font-black text-blue-700">{row.referencia}</div>
                      <div className="mt-1 text-xs font-bold text-slate-700">
                        E{row.estoque} • M{row.modulo} • {row.posicao || "Rua"}
                      </div>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[9px] font-black uppercase ${
                      row.tipo === "Entrada"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700"
                    }`}>
                      {row.tipo}
                    </span>
                  </div>

                  <div className="mt-3 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-slate-800">{row.quantidade.toLocaleString("pt-BR")} pçs</span>
                      <span className="text-[10px] font-bold text-slate-400">{row.data} • {row.hora}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500">
                      <span>Responsável: <strong className="text-slate-700">{row.responsavel || "—"}</strong></span>
                      <span>Galpão: <strong className="text-slate-700">{row.galpao || "3"}</strong></span>
                      {row.dataChacote && <span>Chacote: <strong className="text-slate-700">{row.dataChacote}</strong></span>}
                      {row.observacao && <span>Obs.: <strong className="text-slate-700">{row.observacao}</strong></span>}
                    </div>
                  </div>
                </article>
              ))}

              {filteredHistory.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-400">
                  Nenhuma movimentação encontrada.
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === "ai" && (
          <section className="flex min-h-full flex-col">
            <div className="mb-3">
              <h1 className="text-xl font-black tracking-tight">Consultor IA</h1>
              <p className="mt-1 text-xs font-medium text-slate-500">
                Inteligência operacional baseada nos dados registrados.
              </p>
            </div>

            <div className="mb-3 grid grid-cols-1 gap-2">
              {[
                "Qual o melhor local para armazenar este SKU?",
                "Qual o melhor palete para separação?",
                "Qual palete devo remontar?",
              ].map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => focusConsultorChat(prompt.replace("este SKU", "o SKU "))}
                  className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-left text-[11px] font-bold text-indigo-800"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <div
              ref={chatContainerRef}
              className="min-h-[45vh] flex-1 space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              {chatMessages.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-3 text-xs font-medium leading-relaxed ${
                      message.sender === "user"
                        ? "rounded-br-md bg-blue-600 text-white"
                        : "rounded-bl-md bg-slate-100 text-slate-700"
                    }`}
                  >
                    {message.text}
                  </div>
                </div>
              ))}
            </div>

            <form
              onSubmit={event => {
                event.preventDefault();
                onSendChatMessage();
              }}
              className="sticky bottom-0 mt-3 flex gap-2 bg-slate-50 py-2"
            >
              <input
                ref={chatInputRef}
                value={chatInput}
                onChange={event => onChatInputChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSendChatMessage();
                  }
                }}
                placeholder="Pergunte ao Consultor..."
                enterKeyHint="send"
                className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                disabled={!chatInput.trim()}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40"
                aria-label="Enviar pergunta"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>

            {recommendationAvailable && (
              <button
                type="button"
                onClick={onNextRecommendation}
                className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white text-xs font-black uppercase text-indigo-700"
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </section>
        )}
      </main>

      <nav
        className={`fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_18px_rgba(15,23,42,0.08)] backdrop-blur transition-transform duration-150 ${
          keyboardOpen ? "translate-y-full" : "translate-y-0"
        }`}
        aria-hidden={keyboardOpen}
      >
        <div className="grid grid-cols-5">
          {navItems.map(item => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 text-[9px] font-black uppercase ${
                  active ? "text-blue-600" : "text-slate-400"
                }`}
              >
                <Icon className={`h-5 w-5 ${active ? "stroke-[2.5]" : ""}`} />
                {item.badge ? (
                  <span className="absolute right-[22%] top-2 min-w-4 rounded-full bg-red-500 px-1 text-[8px] leading-4 text-white">
                    {item.badge}
                  </span>
                ) : null}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {scannerTarget && (
        <div className="fixed inset-0 z-[200] flex h-[100dvh] flex-col bg-slate-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
            <div>
              <div className="text-sm font-black">Escanear {scannerTarget === "sku" ? "SKU" : "posição"}</div>
              <div className="mt-0.5 text-[10px] font-medium text-slate-400">
                Aponte a câmera para o QR Code ou código de barras.
              </div>
            </div>
            <button
              type="button"
              onClick={stopScanner}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
              aria-label="Fechar scanner"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative min-h-0 flex-1 items-center justify-center overflow-hidden">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-8 rounded-3xl border-2 border-white/80">
              <div className="absolute left-1/2 top-1/2 h-0.5 w-[75%] -translate-x-1/2 bg-blue-400" />
            </div>

            {(scannerError || !scannerSupported) && (
              <div className="absolute bottom-8 left-4 right-4 rounded-2xl bg-black/80 p-4 text-center text-xs font-semibold text-white">
                {scannerError}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
