import { useCallback, useMemo, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackButton } from "@/components";
import { auth } from "@/services";
import { supabase } from "@/services/supabaseClient";
import { hapticMedium, hapticSuccess } from "@/utils/haptics";
import { formatServiceDate, formatServiceTime } from "@/utils/serviceRequestSchedule";
import {
  createShopScheduleEvent,
  deleteShopScheduleEvent,
  listShopScheduleEvents,
  updateShopScheduleEvent,
  type ShopScheduleEvent,
  type ShopScheduleEventInput,
  type ShopScheduleEventType,
} from "@/utils/shopSchedule";

type IoniconName = ComponentProps<typeof Ionicons>["name"];
type ScheduleFilter = "all" | "requests" | "shop";

type ServiceRequestRecord = {
  id: string;
  shopId: string;
  requesterId: string;
  productName?: string | null;
  variationName?: string | null;
  deceasedFullName?: string | null;
  familyCoordinatorName?: string | null;
  wakeAddress?: string | null;
  churchName?: string | null;
  cemeteryName?: string | null;
  pickupAddress?: string | null;
  wakeStartDate?: string | null;
  wakeEndDate?: string | null;
  burialTime?: string | null;
  status: string;
  [key: string]: unknown;
};

type ScheduleItem = {
  id: string;
  source: "request" | "shop";
  dateKey: string;
  timeSort: string;
  timeLabel: string;
  title: string;
  subtitle: string;
  location: string | null;
  color: string;
  background: string;
  icon: IoniconName;
  milestone?: "wake" | "burial";
  request?: ServiceRequestRecord;
  manualEvent?: ShopScheduleEvent;
};

type EventForm = {
  title: string;
  eventType: ShopScheduleEventType;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  notes: string;
};

const ACTIVE_REQUEST_STATUSES = [
  "accepted_by_shop",
  "awaiting_payment",
  "payment_submitted",
  "payment_verified",
  "awaiting_customer_confirmation",
  "completed",
];

const EVENT_TYPE_META: Record<
  ShopScheduleEventType,
  { label: string; icon: IoniconName; color: string; background: string }
> = {
  appointment: { label: "Appointment", icon: "people-outline", color: "#2c5f87", background: "#eaf3fa" },
  delivery: { label: "Delivery", icon: "car-outline", color: "#2f6b55", background: "#eaf5ef" },
  follow_up: { label: "Follow-up", icon: "call-outline", color: "#7b5c31", background: "#f8f0df" },
  blocked: { label: "Unavailable", icon: "ban-outline", color: "#93433e", background: "#faeae8" },
  other: { label: "Other", icon: "calendar-outline", color: "#5d5b82", background: "#efeff8" },
};

const EMPTY_EVENT_FORM: EventForm = {
  title: "",
  eventType: "appointment",
  eventDate: "",
  startTime: "09:00",
  endTime: "",
  location: "",
  notes: "",
};

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const REGISTER_REMARKS: Record<string, string> = {
  accepted_by_shop: "Accepted · Review preparation",
  awaiting_payment: "Awaiting family payment",
  payment_submitted: "Payment receipt submitted",
  payment_verified: "Payment verified · Prepare service",
  awaiting_customer_confirmation: "Awaiting family confirmation",
  completed: "Service completed",
};

const getRegisterRemarks = (status: string) =>
  REGISTER_REMARKS[String(status || "").toLowerCase()] || "Open service request";

const padNumber = (value: number) => String(value).padStart(2, "0");
const toDateKey = (date: Date) =>
  date.getFullYear() + "-" + padNumber(date.getMonth() + 1) + "-" + padNumber(date.getDate());

const dateFromKey = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toDateKey(date) === value ? date : null;
};

const normalizeDateKey = (value: string | null | undefined) => {
  if (!value) return null;
  const leadingDate = String(value).slice(0, 10);
  return dateFromKey(leadingDate) ? leadingDate : null;
};

const monthStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const buildCalendarDays = (month: Date) => {
  const first = monthStart(month);
  const firstCell = new Date(first);
  firstCell.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstCell);
    date.setDate(firstCell.getDate() + index);
    return date;
  });
};

const formatDayHeading = (dateKey: string) => {
  const date = dateFromKey(dateKey);
  if (!date) return dateKey;
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

const formatClock = (value: string | null | undefined) => {
  if (!value) return "All day";
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
};

const requestSubtitle = (request: ServiceRequestRecord) =>
  [request.productName || "Funeral service", request.familyCoordinatorName || "Family coordinator"]
    .filter(Boolean)
    .join(" · ");

const buildRequestScheduleItems = (requests: ServiceRequestRecord[]): ScheduleItem[] => {
  const items: ScheduleItem[] = [];
  requests.forEach((request) => {
    const deceasedName = request.deceasedFullName || "Service request";
    const startDate = normalizeDateKey(request.wakeStartDate);
    const endDate = normalizeDateKey(request.wakeEndDate);
    if (startDate) {
      items.push({
        id: "wake-start-" + request.id, source: "request", dateKey: startDate,
        timeSort: "00:00", timeLabel: "All day", title: "Wake begins · " + deceasedName,
        subtitle: requestSubtitle(request), location: request.wakeAddress || null,
        color: "#7a5b37", background: "#f8f0df", icon: "home-outline", milestone: "wake", request,
      });
    }
    if (endDate && endDate !== startDate) {
      items.push({
        id: "wake-end-" + request.id, source: "request", dateKey: endDate,
        timeSort: "00:01", timeLabel: "All day", title: "Wake ends · " + deceasedName,
        subtitle: requestSubtitle(request), location: request.wakeAddress || null,
        color: "#7a5b37", background: "#f8f0df", icon: "home-outline", milestone: "wake", request,
      });
    }
    if (endDate && request.burialTime) {
      const timeMatch = /^(\d{2}:\d{2})/.exec(String(request.burialTime));
      items.push({
        id: "burial-" + request.id, source: "request", dateKey: endDate,
        timeSort: timeMatch?.[1] || "12:00", timeLabel: formatServiceTime(request.burialTime),
        title: "Burial service · " + deceasedName, subtitle: requestSubtitle(request),
        location: request.cemeteryName || request.pickupAddress || request.wakeAddress || null,
        color: "#6a5278", background: "#f2edf5", icon: "flower-outline", milestone: "burial", request,
      });
    }
  });
  return items;
};

const manualScheduleItem = (event: ShopScheduleEvent): ScheduleItem => {
  const meta = EVENT_TYPE_META[event.event_type];
  const timeRange = event.end_time
    ? formatClock(event.start_time) + " – " + formatClock(event.end_time)
    : formatClock(event.start_time);
  return {
    id: "manual-" + event.id,
    source: "shop",
    dateKey: event.event_date,
    timeSort: event.start_time?.slice(0, 5) || "00:00",
    timeLabel: timeRange,
    title: event.title,
    subtitle: meta.label + (event.notes ? " · " + event.notes : ""),
    location: event.location,
    color: meta.color,
    background: meta.background,
    icon: meta.icon,
    manualEvent: event,
  };
};

export default function FuneralShopScheduleScreen({ navigation }: any) {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const todayKey = toDateKey(new Date());
  const [visibleMonth, setVisibleMonth] = useState(monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [filter, setFilter] = useState<ScheduleFilter>("all");
  const [requests, setRequests] = useState<ServiceRequestRecord[]>([]);
  const [manualEvents, setManualEvents] = useState<ShopScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(new Date().getFullYear());
  const [monthPickerYearInput, setMonthPickerYearInput] = useState(String(new Date().getFullYear()));
  const [monthPickerMonth, setMonthPickerMonth] = useState(new Date().getMonth());
  const [editingEvent, setEditingEvent] = useState<ShopScheduleEvent | null>(null);
  const [eventForm, setEventForm] = useState<EventForm>(EMPTY_EVENT_FORM);
  const [savingEvent, setSavingEvent] = useState(false);

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const rangeStart = toDateKey(calendarDays[0]);
  const rangeEnd = toDateKey(calendarDays[calendarDays.length - 1]);

  const loadSchedule = useCallback(
    async (quiet = false) => {
      const user = auth.currentUser;
      if (!user) return;
      if (quiet) setRefreshing(true);
      else setLoading(true);
      setLoadError(null);
      try {
        const [requestResult, eventRows] = await Promise.all([
          supabase
            .from("funeral_service_requests")
            .select("*")
            .eq("shopId", user.uid)
            .in("status", ACTIVE_REQUEST_STATUSES)
            .limit(500),
          listShopScheduleEvents(user.uid, rangeStart, rangeEnd),
        ]);
        if (requestResult.error) throw requestResult.error;
        setRequests((requestResult.data || []) as ServiceRequestRecord[]);
        setManualEvents(eventRows);
      } catch (error: any) {
        console.warn("Unable to load the service schedule:", error);
        setLoadError(error?.message || "Unable to load the service schedule.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [rangeEnd, rangeStart]
  );

  useFocusEffect(
    useCallback(() => {
      void loadSchedule();
    }, [loadSchedule])
  );

  const allItems = useMemo(() => {
    return [...buildRequestScheduleItems(requests), ...manualEvents.map(manualScheduleItem)].sort(
      (a, b) => a.dateKey.localeCompare(b.dateKey) || a.timeSort.localeCompare(b.timeSort)
    );
  }, [manualEvents, requests]);

  const visibleItems = useMemo(
    () =>
      allItems.filter((item) => {
        if (filter === "requests") return item.source === "request";
        if (filter === "shop") return item.source === "shop";
        return true;
      }),
    [allItems, filter]
  );

  const itemsByDate = useMemo(() => {
    const grouped: Record<string, ScheduleItem[]> = {};
    visibleItems.forEach((item) => {
      grouped[item.dateKey] = [...(grouped[item.dateKey] || []), item];
    });
    return grouped;
  }, [visibleItems]);

  const selectedItems = itemsByDate[selectedDate] || [];
  const nextSevenEnd = new Date();
  nextSevenEnd.setDate(nextSevenEnd.getDate() + 7);
  const nextSevenEndKey = toDateKey(nextSevenEnd);
  const todayCount = allItems.filter((item) => item.dateKey === todayKey).length;
  const upcomingCount = allItems.filter(
    (item) => item.dateKey >= todayKey && item.dateKey <= nextSevenEndKey
  ).length;
  const shopEventCount = manualEvents.length;
  const serviceRegisterRows = useMemo(() => {
    const selectedYear = visibleMonth.getFullYear();
    return requests
      .filter((request) => {
        const registerDate = normalizeDateKey(request.wakeEndDate) || normalizeDateKey(request.wakeStartDate);
        return registerDate ? Number(registerDate.slice(0, 4)) === selectedYear : false;
      })
      .sort((a, b) =>
        String(a.wakeStartDate || a.wakeEndDate || "").localeCompare(
          String(b.wakeStartDate || b.wakeEndDate || "")
        )
      );
  }, [requests, visibleMonth]);

  const moveMonth = (offset: number) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setVisibleMonth(next);
    setSelectedDate(toDateKey(next));
    hapticMedium();
  };

  const openMonthPicker = () => {
    setMonthPickerYear(visibleMonth.getFullYear());
    setMonthPickerYearInput(String(visibleMonth.getFullYear()));
    setMonthPickerMonth(visibleMonth.getMonth());
    setMonthPickerVisible(true);
    hapticMedium();
  };

  const commitMonthPickerYear = () => {
    const parsedYear = Number(monthPickerYearInput);
    if (Number.isInteger(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
      setMonthPickerYear(parsedYear);
      setMonthPickerYearInput(String(parsedYear));
      return parsedYear;
    }
    setMonthPickerYearInput(String(monthPickerYear));
    return monthPickerYear;
  };

  const changeMonthPickerYear = (offset: number) => {
    const currentYear = Number(monthPickerYearInput);
    const baseYear = Number.isInteger(currentYear) && currentYear >= 1900 && currentYear <= 2100
      ? currentYear
      : monthPickerYear;
    const nextYear = Math.max(1900, Math.min(2100, baseYear + offset));
    setMonthPickerYear(nextYear);
    setMonthPickerYearInput(String(nextYear));
  };

  const selectMonth = (monthIndex: number) => {
    setMonthPickerMonth(monthIndex);
    hapticMedium();
  };

  const applyMonthPickerSelection = () => {
    const next = new Date(commitMonthPickerYear(), monthPickerMonth, 1);
    setVisibleMonth(next);
    setSelectedDate(toDateKey(next));
    setMonthPickerVisible(false);
    hapticMedium();
  };

  const goToToday = () => {
    const today = new Date();
    setVisibleMonth(monthStart(today));
    setSelectedDate(toDateKey(today));
    hapticMedium();
  };

  const selectCalendarDate = (date: Date) => {
    setSelectedDate(toDateKey(date));
    if (date.getMonth() !== visibleMonth.getMonth() || date.getFullYear() !== visibleMonth.getFullYear()) {
      setVisibleMonth(monthStart(date));
    }
    hapticMedium();
  };

  const openCreateEvent = () => {
    setEditingEvent(null);
    setEventForm({ ...EMPTY_EVENT_FORM, eventDate: selectedDate });
    setEventModalVisible(true);
  };

  const openEditEvent = (event: ShopScheduleEvent) => {
    setEditingEvent(event);
    setEventForm({
      title: event.title,
      eventType: event.event_type,
      eventDate: event.event_date,
      startTime: event.start_time?.slice(0, 5) || "09:00",
      endTime: event.end_time?.slice(0, 5) || "",
      location: event.location || "",
      notes: event.notes || "",
    });
    setEventModalVisible(true);
  };

  const closeEventModal = () => {
    if (savingEvent) return;
    setEventModalVisible(false);
    setEditingEvent(null);
    setEventForm(EMPTY_EVENT_FORM);
  };

  const saveEvent = async () => {
    const user = auth.currentUser;
    const title = eventForm.title.trim();
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!user) return;
    if (title.length < 2) {
      Alert.alert("Title Required", "Enter a short name for this schedule event.");
      return;
    }
    if (!dateFromKey(eventForm.eventDate)) {
      Alert.alert("Invalid Date", "Use a valid date in YYYY-MM-DD format.");
      return;
    }
    if (!timePattern.test(eventForm.startTime)) {
      Alert.alert("Invalid Start Time", "Use 24-hour HH:MM format, such as 09:30.");
      return;
    }
    if (eventForm.endTime && !timePattern.test(eventForm.endTime)) {
      Alert.alert("Invalid End Time", "Use 24-hour HH:MM format, such as 11:00.");
      return;
    }
    if (eventForm.endTime && eventForm.endTime <= eventForm.startTime) {
      Alert.alert("Invalid Time Range", "The end time must be later than the start time.");
      return;
    }

    const input: ShopScheduleEventInput = {
      title,
      eventType: eventForm.eventType,
      eventDate: eventForm.eventDate,
      startTime: eventForm.startTime,
      endTime: eventForm.endTime,
      location: eventForm.location,
      notes: eventForm.notes,
    };

    setSavingEvent(true);
    try {
      const savedEvent = editingEvent
        ? await updateShopScheduleEvent(editingEvent.id, input)
        : await createShopScheduleEvent(user.uid, input);
      setManualEvents((current) =>
        [...current.filter((event) => event.id !== savedEvent.id), savedEvent].sort(
          (a, b) =>
            a.event_date.localeCompare(b.event_date) ||
            String(a.start_time || "").localeCompare(String(b.start_time || ""))
        )
      );
      setEventModalVisible(false);
      setEditingEvent(null);
      setEventForm(EMPTY_EVENT_FORM);
      setSelectedDate(input.eventDate);
      const savedDate = dateFromKey(input.eventDate);
      if (savedDate) setVisibleMonth(monthStart(savedDate));
      hapticSuccess();
    } catch (error: any) {
      Alert.alert("Event Not Saved", error?.message || "Unable to save this schedule event.");
    } finally {
      setSavingEvent(false);
    }
  };

  const removeEvent = (event: ShopScheduleEvent) => {
    Alert.alert("Delete Schedule Event", "Delete “" + event.title + "”? This cannot be undone.", [
      { text: "Keep Event", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteShopScheduleEvent(event.id);
            setManualEvents((current) => current.filter((item) => item.id !== event.id));
            hapticSuccess();
          } catch (error: any) {
            Alert.alert("Event Not Deleted", error?.message || "Unable to delete this event.");
          }
        },
      },
    ]);
  };

  const openScheduleItem = (item: ScheduleItem) => {
    if (item.request) navigation.navigate("ServiceRequestDetails", { request: item.request });
    else if (item.manualEvent) openEditEvent(item.manualEvent);
  };

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.headerSafeArea}>
        <View style={styles.headerBar}>
          <AppBackButton onPress={() => navigation.goBack()} />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Service Schedule</Text>
          </View>
          <TouchableOpacity
            style={styles.headerAddButton}
            onPress={openCreateEvent}
            accessibilityRole="button"
            accessibilityLabel="Add schedule event"
          >
            <Ionicons name="add" size={22} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={["bottom"]} style={styles.bodySafeArea}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="calendar-clear-outline" size={28} color="#ffffff" />
            </View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroTitle}>Plan every service in one place</Text>
              <Text style={styles.heroSubtitle}>
                Request wake and burial dates appear automatically. Add private appointments,
                deliveries, follow-ups, or unavailable time for your shop.
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: "#eaf5ef" }]}>
                <Ionicons name="today-outline" size={18} color="#2f6b55" />
              </View>
              <Text style={styles.statValue}>{todayCount}</Text>
              <Text style={styles.statLabel}>Today</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: "#f8f0df" }]}>
                <Ionicons name="calendar-outline" size={18} color="#7a5b37" />
              </View>
              <Text style={styles.statValue}>{upcomingCount}</Text>
              <Text style={styles.statLabel}>Next 7 days</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: "#efeff8" }]}>
                <Ionicons name="create-outline" size={18} color="#5d5b82" />
              </View>
              <Text style={styles.statValue}>{shopEventCount}</Text>
              <Text style={styles.statLabel}>Shop events</Text>
            </View>
          </View>

          <View style={styles.filterRow}>
            {([
              { key: "all", label: "All schedule", icon: "layers-outline" },
              { key: "requests", label: "Service requests", icon: "receipt-outline" },
              { key: "shop", label: "Shop events", icon: "storefront-outline" },
            ] as { key: ScheduleFilter; label: string; icon: IoniconName }[]).map((entry) => (
              <TouchableOpacity
                key={entry.key}
                style={[styles.filterChip, filter === entry.key ? styles.filterChipActive : null]}
                onPress={() => setFilter(entry.key)}
              >
                <Ionicons name={entry.icon} size={15} color={filter === entry.key ? "#ffffff" : "#65736e"} />
                <Text
                  numberOfLines={1}
                  style={[styles.filterChipText, filter === entry.key ? styles.filterChipTextActive : null]}
                >
                  {entry.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loadError ? (
            <View style={styles.errorCard}>
              <Ionicons name="cloud-offline-outline" size={21} color="#98463f" />
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Schedule could not load</Text>
                <Text style={styles.errorText}>{loadError}</Text>
              </View>
              <TouchableOpacity style={styles.retryButton} onPress={() => void loadSchedule()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator size="large" color="#2f6b55" />
              <Text style={styles.loadingTitle}>Building your schedule</Text>
              <Text style={styles.loadingText}>Combining service requests and shop events...</Text>
            </View>
          ) : (
            <>
            <View style={[styles.workspace, isWide ? styles.workspaceWide : null]}>
              <View style={[styles.calendarCard, isWide ? styles.calendarCardWide : null]}>
                <View style={styles.calendarHeader}>
                  <TouchableOpacity style={styles.monthButton} onPress={() => moveMonth(-1)}>
                    <Ionicons name="chevron-back" size={20} color="#31423c" />
                  </TouchableOpacity>
                  <View style={styles.monthCopy}>
                    <TouchableOpacity
                      style={styles.monthSelector}
                      onPress={openMonthPicker}
                      accessibilityRole="button"
                      accessibilityLabel="Choose calendar month and year"
                    >
                      <Text style={styles.monthTitle}>
                        {visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color="#3b725e" />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={goToToday}>
                      <Text style={styles.todayLink}>Go to today</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.monthButton} onPress={() => moveMonth(1)}>
                    <Ionicons name="chevron-forward" size={20} color="#31423c" />
                  </TouchableOpacity>
                </View>

                <View style={styles.weekdayRow}>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <Text key={day} style={styles.weekdayLabel}>{day}</Text>
                  ))}
                </View>

                <View style={styles.calendarGrid}>
                  {calendarDays.map((date) => {
                    const dateKey = toDateKey(date);
                    const dayItems = itemsByDate[dateKey] || [];
                    const selected = dateKey === selectedDate;
                    const today = dateKey === todayKey;
                    const inMonth = date.getMonth() === visibleMonth.getMonth();
                    return (
                      <TouchableOpacity
                        key={dateKey}
                        activeOpacity={0.75}
                        style={[
                          styles.dayCell,
                          !inMonth ? styles.dayCellOutside : null,
                          selected ? styles.dayCellSelected : null,
                        ]}
                        onPress={() => selectCalendarDate(date)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          formatDayHeading(dateKey) +
                          (dayItems.length ? ", " + dayItems.length + " scheduled items" : "")
                        }
                      >
                        <View style={[styles.dayNumberWrap, today ? styles.dayNumberToday : null]}>
                          <Text
                            style={[
                              styles.dayNumber,
                              !inMonth ? styles.dayNumberOutside : null,
                              today ? styles.dayNumberTodayText : null,
                              selected && !today ? styles.dayNumberSelectedText : null,
                            ]}
                          >
                            {date.getDate()}
                          </Text>
                        </View>
                        <View style={styles.dayDots}>
                          {dayItems.slice(0, 3).map((item) => (
                            <View key={item.id} style={[styles.dayDot, { backgroundColor: item.color }]} />
                          ))}
                          {dayItems.length > 3 ? <Text style={styles.dayMore}>+{dayItems.length - 3}</Text> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.legendRow}>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: "#7a5b37" }]} />
                    <Text style={styles.legendText}>Wake</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: "#6a5278" }]} />
                    <Text style={styles.legendText}>Burial</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: "#2f6b55" }]} />
                    <Text style={styles.legendText}>Shop event</Text>
                  </View>
                </View>
              </View>

              <View style={[styles.agendaCard, isWide ? styles.agendaCardWide : null]}>
                <View style={styles.agendaHeader}>
                  <View style={styles.agendaHeading}>
                    <Text style={styles.agendaTitle}>{formatDayHeading(selectedDate)}</Text>
                    <Text style={styles.agendaCount}>
                      {selectedItems.length === 1 ? "1 scheduled item" : selectedItems.length + " scheduled items"}
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.agendaAddButton} onPress={openCreateEvent}>
                    <Ionicons name="add" size={19} color="#ffffff" />
                  </TouchableOpacity>
                </View>

                {selectedItems.length ? (
                  <View style={styles.agendaList}>
                    {selectedItems.map((item) => {
                      const requestStatus = String(item.request?.status || "").toLowerCase();
                      const burialDone = item.milestone === "burial" && requestStatus === "completed";
                      const burialAwaitingFamily = item.milestone === "burial" && requestStatus === "awaiting_customer_confirmation";
                      const burialCanBeCompleted = item.milestone === "burial" && requestStatus === "payment_verified";
                      return (
                        <TouchableOpacity
                        key={item.id}
                        style={styles.agendaItem}
                        activeOpacity={0.82}
                        onPress={() => openScheduleItem(item)}
                      >
                        <View style={[styles.agendaItemIcon, { backgroundColor: item.background }]}>
                          <Ionicons name={item.icon} size={20} color={item.color} />
                        </View>
                        <View style={styles.agendaItemCopy}>
                          <View style={styles.agendaItemTopRow}>
                            <Text style={styles.agendaItemTime}>{item.timeLabel}</Text>
                            <View
                              style={[
                                styles.sourceBadge,
                                item.source === "request" ? styles.requestSourceBadge : styles.shopSourceBadge,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.sourceBadgeText,
                                  item.source === "request"
                                    ? styles.requestSourceBadgeText
                                    : styles.shopSourceBadgeText,
                                ]}
                              >
                                {item.source === "request" ? "REQUEST" : "SHOP"}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.agendaItemTitle}>{item.title}</Text>
                          <Text style={styles.agendaItemSubtitle} numberOfLines={2}>{item.subtitle}</Text>
                          {item.location ? (
                            <View style={styles.agendaLocationRow}>
                              <Ionicons name="location-outline" size={14} color="#7a8580" />
                              <Text style={styles.agendaLocation} numberOfLines={2}>{item.location}</Text>
                            </View>
                          ) : null}
                          {item.milestone === "burial" && item.request ? (
                            <View
                              style={[
                                styles.burialState,
                                burialDone ? styles.burialStateDone : null,
                                burialAwaitingFamily ? styles.burialStatePending : null,
                              ]}
                            >
                              <Ionicons
                                name={burialDone ? "checkmark-circle" : burialAwaitingFamily ? "time" : "ellipse-outline"}
                                size={15}
                                color={burialDone ? "#2f6b55" : burialAwaitingFamily ? "#8a632e" : "#7a8580"}
                              />
                              <Text
                                style={[
                                  styles.burialStateText,
                                  burialDone ? styles.burialStateTextDone : null,
                                  burialAwaitingFamily ? styles.burialStateTextPending : null,
                                ]}
                              >
                                {burialDone
                                  ? "Done · Confirmed by family"
                                  : burialAwaitingFamily
                                    ? "Marked done · Awaiting family confirmation"
                                    : "Not marked done"}
                              </Text>
                            </View>
                          ) : null}
                          <View style={styles.agendaItemActionRow}>
                            <Text style={styles.agendaOpenText}>
                              {item.source !== "request"
                                ? "Edit event"
                                : item.milestone !== "burial"
                                  ? "Open request"
                                  : burialDone
                                    ? "View completed request"
                                    : burialAwaitingFamily
                                      ? "View confirmation status"
                                      : burialCanBeCompleted
                                        ? "Open request to mark done"
                                        : "Open burial request"}
                            </Text>
                            <Ionicons name="arrow-forward" size={15} color="#41675a" />
                          </View>
                        </View>
                        {item.manualEvent ? (
                          <TouchableOpacity
                            style={styles.deleteEventButton}
                            onPress={() => removeEvent(item.manualEvent!)}
                            accessibilityRole="button"
                            accessibilityLabel={"Delete " + item.title}
                          >
                            <Ionicons name="trash-outline" size={17} color="#9b4540" />
                          </TouchableOpacity>
                        ) : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.emptyAgenda}>
                    <View style={styles.emptyAgendaIcon}>
                      <Ionicons name="calendar-outline" size={28} color="#74827d" />
                    </View>
                    <Text style={styles.emptyAgendaTitle}>Nothing scheduled</Text>
                    <Text style={styles.emptyAgendaText}>
                      This date has no matching request milestones or private shop events.
                    </Text>
                    <TouchableOpacity style={styles.emptyAgendaButton} onPress={openCreateEvent}>
                      <Ionicons name="add" size={17} color="#ffffff" />
                      <Text style={styles.emptyAgendaButtonText}>Add shop event</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.registerCard}>
              <View style={styles.registerHeader}>
                <View style={styles.registerHeadingCopy}>
                  <Text style={styles.registerTitle}>Funeral Service Register</Text>
                  <Text style={styles.registerSubtitle}>
                    Active and completed services scheduled in {visibleMonth.getFullYear()}. Tap a record to open its request.
                  </Text>
                </View>
                <View style={styles.registerCountBadge}>
                  <Text style={styles.registerCountValue}>{serviceRegisterRows.length}</Text>
                  <Text style={styles.registerCountLabel}>{serviceRegisterRows.length === 1 ? "record" : "records"}</Text>
                </View>
              </View>

              {serviceRegisterRows.length ? (
                isWide ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.registerTableScroll}>
                    <View style={styles.registerTable}>
                      <View style={styles.registerTableHeader}>
                        <Text style={[styles.registerHeaderCell, styles.registerNameColumn]}>Deceased</Text>
                        <Text style={[styles.registerHeaderCell, styles.registerAddressColumn]}>Address</Text>
                        <Text style={[styles.registerHeaderCell, styles.registerDateColumn]}>Service date</Text>
                        <Text style={[styles.registerHeaderCell, styles.registerCasketColumn]}>Casket</Text>
                        <Text style={[styles.registerHeaderCell, styles.registerBurialColumn]}>Burial date</Text>
                        <Text style={[styles.registerHeaderCell, styles.registerLocationColumn]}>Cemetery / location</Text>
                        <Text style={[styles.registerHeaderCell, styles.registerRemarksColumn]}>Remarks</Text>
                      </View>
                      {serviceRegisterRows.map((request) => {
                        const casket = [request.productName || "Custom casket", request.variationName].filter(Boolean).join(" · ");
                        const burial = request.wakeEndDate
                          ? formatServiceDate(request.wakeEndDate, "Not scheduled") + (request.burialTime ? " · " + formatServiceTime(request.burialTime) : "")
                          : "Not scheduled";
                        return (
                          <TouchableOpacity
                            key={request.id}
                            style={styles.registerTableRow}
                            onPress={() => navigation.navigate("ServiceRequestDetails", { request })}
                            accessibilityRole="button"
                            accessibilityLabel={"Open service record for " + (request.deceasedFullName || "unnamed service")}
                          >
                            <Text style={[styles.registerCellStrong, styles.registerNameColumn]} numberOfLines={2}>{request.deceasedFullName || "Not provided"}</Text>
                            <Text style={[styles.registerCell, styles.registerAddressColumn]} numberOfLines={3}>{request.wakeAddress || "Not provided"}</Text>
                            <Text style={[styles.registerCell, styles.registerDateColumn]} numberOfLines={2}>{formatServiceDate(request.wakeStartDate, "Not scheduled")}</Text>
                            <Text style={[styles.registerCell, styles.registerCasketColumn]} numberOfLines={3}>{casket}</Text>
                            <Text style={[styles.registerCell, styles.registerBurialColumn]} numberOfLines={3}>{burial}</Text>
                            <Text style={[styles.registerCell, styles.registerLocationColumn]} numberOfLines={3}>{request.cemeteryName || "Not recorded"}</Text>
                            <Text style={[styles.registerRemarksText, styles.registerRemarksColumn]} numberOfLines={3}>{getRegisterRemarks(request.status)}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>
                ) : (
                  <View style={styles.registerMobileList}>
                    {serviceRegisterRows.map((request) => {
                      const casket = [request.productName || "Custom casket", request.variationName].filter(Boolean).join(" · ");
                      const burial = request.wakeEndDate
                        ? formatServiceDate(request.wakeEndDate, "Not scheduled") + (request.burialTime ? " · " + formatServiceTime(request.burialTime) : "")
                        : "Not scheduled";
                      return (
                        <TouchableOpacity
                          key={request.id}
                          style={styles.registerMobileCard}
                          onPress={() => navigation.navigate("ServiceRequestDetails", { request })}
                          accessibilityRole="button"
                          accessibilityLabel={"Open service record for " + (request.deceasedFullName || "unnamed service")}
                        >
                          <View style={styles.registerMobileTitleRow}>
                            <View style={styles.registerRecordIcon}>
                              <Ionicons name="document-text-outline" size={19} color="#2f6b55" />
                            </View>
                            <View style={styles.registerMobileTitleCopy}>
                              <Text style={styles.registerMobileName}>{request.deceasedFullName || "Not provided"}</Text>
                              <Text style={styles.registerMobileDate}>{formatServiceDate(request.wakeStartDate, "Date not scheduled")}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color="#83908b" />
                          </View>
                          {[
                            { label: "Address", value: request.wakeAddress || "Not provided" },
                            { label: "Casket", value: casket },
                            { label: "Burial date", value: burial },
                            { label: "Church / chapel", value: request.churchName || "Not recorded" },
                            { label: "Cemetery / location", value: request.cemeteryName || "Not recorded" },
                            { label: "Remarks", value: getRegisterRemarks(request.status), remarks: true },
                          ].map((field) => (
                            <View key={field.label} style={[styles.registerMobileField, field.remarks ? styles.registerRemarksField : null]}>
                              <Text style={styles.registerMobileLabel}>{field.label}</Text>
                              <Text style={[styles.registerMobileValue, field.remarks ? styles.registerMobileRemarks : null]}>{field.value}</Text>
                            </View>
                          ))}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )
              ) : (
                <View style={styles.registerEmpty}>
                  <Ionicons name="document-text-outline" size={25} color="#7e8a85" />
                  <Text style={styles.registerEmptyTitle}>No service records for {visibleMonth.getFullYear()}</Text>
                  <Text style={styles.registerEmptyText}>Requests with scheduled service dates will appear here automatically.</Text>
                </View>
              )}
            </View>
            </>
          )}

          {refreshing ? (
            <View style={styles.syncRow}>
              <ActivityIndicator size="small" color="#2f6b55" />
              <Text style={styles.syncText}>Syncing schedule...</Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={monthPickerVisible} transparent animationType="fade" onRequestClose={() => setMonthPickerVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setMonthPickerVisible(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.monthPickerCard}>
            <View style={styles.monthPickerHeader}>
              <View>
                <Text style={styles.monthPickerTitle}>Choose month and year</Text>
              </View>
              <TouchableOpacity style={styles.modalClose} onPress={() => setMonthPickerVisible(false)}>
                <Ionicons name="close" size={21} color="#50605a" />
              </TouchableOpacity>
            </View>

            <View style={styles.yearSelector}>
              <TouchableOpacity style={styles.yearButton} onPress={() => changeMonthPickerYear(-1)}>
                <Ionicons name="remove" size={19} color="#41544d" />
              </TouchableOpacity>
              <View style={styles.yearInputWrap}>
                <Ionicons name="create-outline" size={15} color="#6a7772" />
                <TextInput
                  style={styles.yearInput}
                  value={monthPickerYearInput}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, "").slice(0, 4);
                    setMonthPickerYearInput(digits);
                    const parsedYear = Number(digits);
                    if (digits.length === 4 && parsedYear >= 1900 && parsedYear <= 2100) setMonthPickerYear(parsedYear);
                  }}
                  onBlur={commitMonthPickerYear}
                  onSubmitEditing={commitMonthPickerYear}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={4}
                  selectTextOnFocus
                  returnKeyType="done"
                  accessibilityLabel="Enter calendar year"
                />
              </View>
              <TouchableOpacity style={styles.yearButton} onPress={() => changeMonthPickerYear(1)}>
                <Ionicons name="add" size={19} color="#41544d" />
              </TouchableOpacity>
            </View>
            <Text style={styles.yearHint}>Tap the year to type any year from 1900 to 2100.</Text>

            <View style={styles.monthGrid}>
              {MONTH_LABELS.map((label, index) => {
                const selected = monthPickerMonth === index;
                const current = new Date().getFullYear() === monthPickerYear && new Date().getMonth() === index;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[styles.monthOption, selected ? styles.monthOptionSelected : null]}
                    onPress={() => selectMonth(index)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.monthOptionText, selected ? styles.monthOptionTextSelected : null]}>{label.slice(0, 3)}</Text>
                    {current ? <View style={[styles.currentMonthDot, selected ? styles.currentMonthDotSelected : null]} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.monthPickerActions}>
              <TouchableOpacity style={styles.currentMonthShortcut} onPress={() => { goToToday(); setMonthPickerVisible(false); }}>
                <Ionicons name="today-outline" size={17} color="#41675a" />
                <Text style={styles.currentMonthShortcutText}>Current month</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.currentMonthButton} onPress={applyMonthPickerSelection}>
                <Ionicons name="checkmark" size={18} color="#ffffff" />
                <Text style={styles.currentMonthButtonText}>Apply month &amp; year</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={eventModalVisible} transparent animationType="fade" onRequestClose={closeEventModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderIcon}>
                  <Ionicons
                    name={editingEvent ? "create-outline" : "calendar-outline"}
                    size={22}
                    color="#2f6b55"
                  />
                </View>
                <View style={styles.modalHeaderCopy}>
                  <Text style={styles.modalTitle}>{editingEvent ? "Edit event" : "Add to schedule"}</Text>
                </View>
                <TouchableOpacity style={styles.modalClose} onPress={closeEventModal}>
                  <Ionicons name="close" size={22} color="#50605a" />
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Event title *</Text>
              <TextInput
                style={styles.input}
                value={eventForm.title}
                onChangeText={(value) => setEventForm((current) => ({ ...current, title: value }))}
                placeholder="Example: Casket delivery"
                placeholderTextColor="#99a19d"
                maxLength={120}
              />

              <Text style={styles.fieldLabel}>Event type *</Text>
              <View style={styles.eventTypeGrid}>
                {(Object.keys(EVENT_TYPE_META) as ShopScheduleEventType[]).map((type) => {
                  const meta = EVENT_TYPE_META[type];
                  const active = eventForm.eventType === type;
                  return (
                    <TouchableOpacity
                      key={type}
                      style={[styles.eventTypeChip, active ? styles.eventTypeChipActive : null]}
                      onPress={() => setEventForm((current) => ({ ...current, eventType: type }))}
                    >
                      <Ionicons name={meta.icon} size={15} color={active ? "#ffffff" : meta.color} />
                      <Text style={[styles.eventTypeChipText, active ? styles.eventTypeChipTextActive : null]}>
                        {meta.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Date *</Text>
              <TextInput
                style={styles.input}
                value={eventForm.eventDate}
                onChangeText={(value) => setEventForm((current) => ({ ...current, eventDate: value }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#99a19d"
                inputMode="numeric"
                maxLength={10}
              />

              <View style={styles.timeFieldsRow}>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>Start *</Text>
                  <TextInput
                    style={styles.input}
                    value={eventForm.startTime}
                    onChangeText={(value) => setEventForm((current) => ({ ...current, startTime: value }))}
                    placeholder="09:00"
                    placeholderTextColor="#99a19d"
                    inputMode="numeric"
                    maxLength={5}
                  />
                </View>
                <View style={styles.timeField}>
                  <Text style={styles.fieldLabel}>End</Text>
                  <TextInput
                    style={styles.input}
                    value={eventForm.endTime}
                    onChangeText={(value) => setEventForm((current) => ({ ...current, endTime: value }))}
                    placeholder="10:30"
                    placeholderTextColor="#99a19d"
                    inputMode="numeric"
                    maxLength={5}
                  />
                </View>
              </View>
              <Text style={styles.timeHint}>Use 24-hour time, for example 14:30.</Text>

              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={eventForm.location}
                onChangeText={(value) => setEventForm((current) => ({ ...current, location: value }))}
                placeholder="Shop, chapel, cemetery, or delivery address"
                placeholderTextColor="#99a19d"
                maxLength={250}
              />

              <Text style={styles.fieldLabel}>Notes</Text>
              <TextInput
                style={[styles.input, styles.notesInput]}
                value={eventForm.notes}
                onChangeText={(value) => setEventForm((current) => ({ ...current, notes: value }))}
                placeholder="Private preparation notes"
                placeholderTextColor="#99a19d"
                multiline
                maxLength={1000}
              />

              <View style={styles.privateNote}>
                <Ionicons name="lock-closed-outline" size={15} color="#6f7d78" />
                <Text style={styles.privateNoteText}>
                  Shop-created events and notes are not visible to customers.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.saveButton, savingEvent ? styles.buttonDisabled : null]}
                onPress={() => void saveEvent()}
                disabled={savingEvent}
              >
                {savingEvent ? <ActivityIndicator size="small" color="#ffffff" /> : null}
                <Text style={styles.saveButtonText}>
                  {savingEvent ? "Saving..." : editingEvent ? "Save changes" : "Add to schedule"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={closeEventModal} disabled={savingEvent}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#eef1ec" },
  headerSafeArea: { backgroundColor: "#f8f6f2" },
  headerBar: {
    minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12,
    borderBottomWidth: 1, borderBottomColor: "#d9d6cd", paddingHorizontal: 16, paddingVertical: 10,
  },
  headerCopy: { flex: 1 },
  headerTitle: { color: "#22312d", fontSize: 21, fontWeight: "900" },
  headerAddButton: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: "#223f36",
    alignItems: "center", justifyContent: "center",
  },
  bodySafeArea: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    width: "100%", maxWidth: 1180, alignSelf: "center", padding: 16, paddingBottom: 44, gap: 14,
  },
  hero: {
    borderRadius: 25, backgroundColor: "#1e3932", padding: 18,
    flexDirection: "row", alignItems: "center", gap: 14,
  },
  heroIcon: {
    width: 54, height: 54, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  heroCopy: { flex: 1 },
  heroTitle: { color: "#ffffff", fontSize: 19, fontWeight: "900" },
  heroSubtitle: { color: "#c6d3cf", fontSize: 12, lineHeight: 18, marginTop: 4 },
  statsRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1, minHeight: 96, borderRadius: 18, borderWidth: 1, borderColor: "#dedbd3",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 10,
  },
  statIcon: { width: 32, height: 32, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  statValue: { color: "#253630", fontSize: 20, fontWeight: "900", marginTop: 5 },
  statLabel: { color: "#75817d", fontSize: 10, fontWeight: "800", textAlign: "center", marginTop: 1 },
  filterRow: { flexDirection: "row", gap: 8 },
  filterChip: {
    flex: 1, minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: "#d9deda",
    backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 5, paddingHorizontal: 8,
  },
  filterChipActive: { borderColor: "#2c4c41", backgroundColor: "#2c4c41" },
  filterChipText: { color: "#65736e", fontSize: 10, fontWeight: "900" },
  filterChipTextActive: { color: "#ffffff" },
  errorCard: {
    borderRadius: 16, borderWidth: 1, borderColor: "#ecc7c3", backgroundColor: "#fff2f0",
    flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
  },
  errorCopy: { flex: 1 },
  errorTitle: { color: "#873e39", fontSize: 12, fontWeight: "900" },
  errorText: { color: "#9a5b55", fontSize: 10, lineHeight: 15, marginTop: 2 },
  retryButton: { borderRadius: 10, backgroundColor: "#ffffff", paddingHorizontal: 11, paddingVertical: 8 },
  retryText: { color: "#873e39", fontSize: 10, fontWeight: "900" },
  loadingCard: {
    minHeight: 300, borderRadius: 22, borderWidth: 1, borderColor: "#dedbd3",
    backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center", padding: 24,
  },
  loadingTitle: { color: "#293a34", fontSize: 16, fontWeight: "900", marginTop: 13 },
  loadingText: { color: "#7a8580", fontSize: 12, marginTop: 4 },
  workspace: { gap: 14 },
  workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  calendarCard: {
    borderRadius: 22, borderWidth: 1, borderColor: "#dedbd3", backgroundColor: "#ffffff", padding: 14,
  },
  calendarCardWide: { flex: 1.2 },
  calendarHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14,
  },
  monthButton: {
    width: 40, height: 40, borderRadius: 13, borderWidth: 1, borderColor: "#dde2df",
    backgroundColor: "#f8faf9", alignItems: "center", justifyContent: "center",
  },
  monthCopy: { flex: 1, alignItems: "center" },
  monthSelector: {
    minHeight: 32, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingHorizontal: 8,
  },
  monthTitle: { color: "#24352f", fontSize: 17, fontWeight: "900" },
  todayLink: { color: "#3b725e", fontSize: 10, fontWeight: "900", marginTop: 3 },
  weekdayRow: {
    flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#edf0ee", paddingBottom: 8,
  },
  weekdayLabel: {
    width: "14.2857%", color: "#7d8884", fontSize: 9, fontWeight: "900",
    textAlign: "center", textTransform: "uppercase",
  },
  calendarGrid: { flexDirection: "row", flexWrap: "wrap", paddingTop: 5 },
  dayCell: {
    width: "14.2857%", minHeight: 55, borderRadius: 12,
    alignItems: "center", paddingTop: 5, paddingHorizontal: 2,
  },
  dayCellOutside: { opacity: 0.42 },
  dayCellSelected: { backgroundColor: "#edf4f1" },
  dayNumberWrap: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dayNumberToday: { backgroundColor: "#2f6b55" },
  dayNumber: { color: "#3d4b46", fontSize: 12, fontWeight: "800" },
  dayNumberOutside: { color: "#8d9692" },
  dayNumberTodayText: { color: "#ffffff" },
  dayNumberSelectedText: { color: "#2f6b55", fontWeight: "900" },
  dayDots: {
    minHeight: 12, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 2, marginTop: 3,
  },
  dayDot: { width: 5, height: 5, borderRadius: 3 },
  dayMore: { color: "#6f7a76", fontSize: 7, fontWeight: "900" },
  legendRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap",
    gap: 15, borderTopWidth: 1, borderTopColor: "#edf0ee", paddingTop: 12, marginTop: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { color: "#6f7b77", fontSize: 10, fontWeight: "700" },
  agendaCard: {
    minHeight: 310, borderRadius: 22, borderWidth: 1, borderColor: "#dedbd3",
    backgroundColor: "#ffffff", padding: 14,
  },
  agendaCardWide: { flex: 0.8, minWidth: 340 },
  agendaHeader: {
    flexDirection: "row", alignItems: "flex-start", gap: 10,
    borderBottomWidth: 1, borderBottomColor: "#edf0ee", paddingBottom: 13,
  },
  agendaHeading: { flex: 1 },
  agendaTitle: { color: "#24352f", fontSize: 15, lineHeight: 20, fontWeight: "900" },
  agendaCount: { color: "#7a8580", fontSize: 10, marginTop: 3 },
  agendaAddButton: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: "#2f6b55",
    alignItems: "center", justifyContent: "center",
  },
  agendaList: { gap: 10, paddingTop: 12 },
  agendaItem: {
    flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 17,
    borderWidth: 1, borderColor: "#e1e5e2", backgroundColor: "#fbfcfb", padding: 11,
  },
  agendaItemIcon: {
    width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center",
  },
  agendaItemCopy: { flex: 1 },
  agendaItemTopRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8,
  },
  agendaItemTime: { flex: 1, color: "#52625c", fontSize: 10, fontWeight: "900" },
  sourceBadge: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 4 },
  requestSourceBadge: { backgroundColor: "#f3eadb" },
  shopSourceBadge: { backgroundColor: "#e5f1eb" },
  sourceBadgeText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.45 },
  requestSourceBadgeText: { color: "#775b38" },
  shopSourceBadgeText: { color: "#2f6b55" },
  agendaItemTitle: { color: "#253630", fontSize: 13, lineHeight: 18, fontWeight: "900", marginTop: 5 },
  agendaItemSubtitle: { color: "#75817d", fontSize: 10, lineHeight: 15, marginTop: 3 },
  agendaLocationRow: { flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 6 },
  agendaLocation: { flex: 1, color: "#6d7974", fontSize: 10, lineHeight: 15 },
  burialState: {
    alignSelf: "flex-start", minHeight: 28, borderRadius: 10, backgroundColor: "#f0f2f1",
    flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 5, marginTop: 8,
  },
  burialStateDone: { backgroundColor: "#e5f3eb" },
  burialStatePending: { backgroundColor: "#f8f0df" },
  burialStateText: { color: "#6f7b77", fontSize: 9, lineHeight: 13, fontWeight: "900" },
  burialStateTextDone: { color: "#2f6b55" },
  burialStateTextPending: { color: "#7b5c31" },
  agendaItemActionRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  agendaOpenText: { color: "#41675a", fontSize: 10, fontWeight: "900" },
  deleteEventButton: {
    width: 34, height: 34, borderRadius: 11, backgroundColor: "#fff0ee",
    alignItems: "center", justifyContent: "center",
  },
  emptyAgenda: {
    flex: 1, minHeight: 235, alignItems: "center", justifyContent: "center", padding: 20,
  },
  emptyAgendaIcon: {
    width: 58, height: 58, borderRadius: 20, backgroundColor: "#edf1ef",
    alignItems: "center", justifyContent: "center",
  },
  emptyAgendaTitle: { color: "#2c3c36", fontSize: 15, fontWeight: "900", marginTop: 12 },
  emptyAgendaText: {
    maxWidth: 310, color: "#7a8580", fontSize: 11, lineHeight: 17, textAlign: "center", marginTop: 5,
  },
  emptyAgendaButton: {
    minHeight: 40, borderRadius: 13, backgroundColor: "#2f6b55", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 13, marginTop: 13,
  },
  emptyAgendaButtonText: { color: "#ffffff", fontSize: 11, fontWeight: "900" },
  syncRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 5,
  },
  syncText: { color: "#687671", fontSize: 11, fontWeight: "700" },
  registerCard: {
    borderRadius: 22, borderWidth: 1, borderColor: "#dedbd3", backgroundColor: "#ffffff",
    padding: 14, overflow: "hidden",
  },
  registerHeader: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    borderBottomWidth: 1, borderBottomColor: "#ecefeb", paddingBottom: 13,
  },
  registerHeadingCopy: { flex: 1 },
  registerTitle: { color: "#24352f", fontSize: 17, fontWeight: "900" },
  registerSubtitle: { color: "#74807c", fontSize: 10, lineHeight: 15, marginTop: 4 },
  registerCountBadge: {
    minWidth: 58, borderRadius: 14, backgroundColor: "#edf4f1", alignItems: "center",
    justifyContent: "center", paddingHorizontal: 9, paddingVertical: 8,
  },
  registerCountValue: { color: "#2f6b55", fontSize: 16, fontWeight: "900" },
  registerCountLabel: { color: "#668077", fontSize: 8, fontWeight: "900", marginTop: 1 },
  registerTableScroll: { paddingTop: 13, paddingBottom: 3 },
  registerTable: {
    minWidth: 1230, borderRadius: 15, borderWidth: 1, borderColor: "#dde2df", overflow: "hidden",
  },
  registerTableHeader: {
    minHeight: 42, flexDirection: "row", alignItems: "center", backgroundColor: "#263d35",
  },
  registerHeaderCell: {
    color: "#ffffff", fontSize: 9, fontWeight: "900", letterSpacing: 0.25,
    paddingHorizontal: 10, textTransform: "uppercase",
  },
  registerTableRow: {
    minHeight: 74, flexDirection: "row", alignItems: "center", borderTopWidth: 1,
    borderTopColor: "#e8ebe9", backgroundColor: "#fbfcfb",
  },
  registerCell: { color: "#66736e", fontSize: 10, lineHeight: 15, paddingHorizontal: 10 },
  registerCellStrong: { color: "#273832", fontSize: 11, lineHeight: 16, fontWeight: "900", paddingHorizontal: 10 },
  registerRemarksText: { color: "#31664f", fontSize: 10, lineHeight: 15, fontWeight: "900", paddingHorizontal: 10 },
  registerNameColumn: { width: 170 },
  registerAddressColumn: { width: 210 },
  registerDateColumn: { width: 145 },
  registerCasketColumn: { width: 175 },
  registerBurialColumn: { width: 180 },
  registerLocationColumn: { width: 190 },
  registerRemarksColumn: { width: 160 },
  registerMobileList: { gap: 10, paddingTop: 12 },
  registerMobileCard: {
    borderRadius: 17, borderWidth: 1, borderColor: "#e0e4e1", backgroundColor: "#fbfcfb", padding: 12,
  },
  registerMobileTitleRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1,
    borderBottomColor: "#e8ebe9", paddingBottom: 11,
  },
  registerRecordIcon: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: "#e8f2ed", alignItems: "center", justifyContent: "center",
  },
  registerMobileTitleCopy: { flex: 1 },
  registerMobileName: { color: "#263731", fontSize: 14, fontWeight: "900" },
  registerMobileDate: { color: "#73807b", fontSize: 9, fontWeight: "700", marginTop: 3 },
  registerMobileField: {
    flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: "#eef0ee",
  },
  registerRemarksField: {
    borderBottomWidth: 0, borderRadius: 12, backgroundColor: "#edf5f1",
    paddingHorizontal: 9, marginTop: 5,
  },
  registerMobileLabel: { width: 104, color: "#7a8580", fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  registerMobileValue: { flex: 1, color: "#40504a", fontSize: 10, lineHeight: 15, fontWeight: "700" },
  registerMobileRemarks: { color: "#2f6b55", fontWeight: "900" },
  registerEmpty: { alignItems: "center", justifyContent: "center", paddingHorizontal: 18, paddingVertical: 28 },
  registerEmptyTitle: { color: "#34453f", fontSize: 13, fontWeight: "900", marginTop: 9 },
  registerEmptyText: { color: "#7a8580", fontSize: 10, lineHeight: 15, textAlign: "center", marginTop: 4 },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(16, 20, 18, 0.62)",
    alignItems: "center", justifyContent: "center", padding: 16,
  },
  modalCard: {
    width: "100%", maxWidth: 560, maxHeight: "90%", borderRadius: 24,
    borderWidth: 1, borderColor: "#d9d6cd", backgroundColor: "#f8f6f2", overflow: "hidden",
  },
  monthPickerCard: {
    width: "100%", maxWidth: 440, borderRadius: 24, borderWidth: 1,
    borderColor: "#d9d6cd", backgroundColor: "#f8f6f2", padding: 18,
  },
  monthPickerHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    gap: 12, borderBottomWidth: 1, borderBottomColor: "#e3e0d9", paddingBottom: 14,
  },
  monthPickerTitle: { color: "#22312d", fontSize: 20, fontWeight: "900", marginTop: 2 },
  yearSelector: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18,
    borderRadius: 16, backgroundColor: "#edf1ef", paddingVertical: 10, marginTop: 16,
  },
  yearButton: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: "#ffffff",
    alignItems: "center", justifyContent: "center",
  },
  yearInputWrap: {
    minWidth: 108, height: 42, borderRadius: 13, borderWidth: 1, borderColor: "#d5dcd8",
    backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 5, paddingHorizontal: 9,
  },
  yearInput: {
    minWidth: 60, color: "#263831", fontSize: 19, fontWeight: "900", textAlign: "center", paddingVertical: 3,
  },
  yearHint: { color: "#74807c", fontSize: 9, lineHeight: 14, textAlign: "center", marginTop: 7 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  monthOption: {
    width: "31%", flexGrow: 1, minHeight: 48, borderRadius: 14, borderWidth: 1,
    borderColor: "#d9deda", backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center",
  },
  monthOptionSelected: { borderColor: "#2f6b55", backgroundColor: "#2f6b55" },
  monthOptionText: { color: "#56655f", fontSize: 12, fontWeight: "900" },
  monthOptionTextSelected: { color: "#ffffff" },
  currentMonthDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#2f6b55", marginTop: 4 },
  currentMonthDotSelected: { backgroundColor: "#d9eee5" },
  monthPickerActions: { flexDirection: "row", gap: 9, marginTop: 16 },
  currentMonthShortcut: {
    flex: 0.8, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: "#cfd9d4",
    backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, paddingHorizontal: 10,
  },
  currentMonthShortcutText: { color: "#41675a", fontSize: 10, fontWeight: "900" },
  currentMonthButton: {
    flex: 1.2, minHeight: 46, borderRadius: 14, backgroundColor: "#223f36", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10,
  },
  currentMonthButtonText: { color: "#ffffff", fontSize: 12, fontWeight: "900" },
  modalContent: { padding: 18 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: 1,
    borderBottomColor: "#e3e0d9", paddingBottom: 14, marginBottom: 6,
  },
  modalHeaderIcon: {
    width: 42, height: 42, borderRadius: 14, backgroundColor: "#e6f1ec",
    alignItems: "center", justifyContent: "center",
  },
  modalHeaderCopy: { flex: 1 },
  modalTitle: { color: "#22312d", fontSize: 20, fontWeight: "900" },
  modalClose: {
    width: 38, height: 38, borderRadius: 13, backgroundColor: "#eceae5",
    alignItems: "center", justifyContent: "center",
  },
  fieldLabel: { color: "#53615d", fontSize: 11, fontWeight: "900", marginTop: 12, marginBottom: 5 },
  input: {
    minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: "#d3d9d5",
    backgroundColor: "#ffffff", color: "#22312d", fontSize: 13,
    paddingHorizontal: 13, paddingVertical: 11,
  },
  eventTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  eventTypeChip: {
    minHeight: 38, borderRadius: 12, borderWidth: 1, borderColor: "#d8ddd9",
    backgroundColor: "#ffffff", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10,
  },
  eventTypeChipActive: { borderColor: "#2f6b55", backgroundColor: "#2f6b55" },
  eventTypeChipText: { color: "#5f6d68", fontSize: 10, fontWeight: "900" },
  eventTypeChipTextActive: { color: "#ffffff" },
  timeFieldsRow: { flexDirection: "row", gap: 10 },
  timeField: { flex: 1 },
  timeHint: { color: "#818b87", fontSize: 10, marginTop: 5 },
  notesInput: { minHeight: 92, textAlignVertical: "top" },
  privateNote: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12,
  },
  privateNoteText: { color: "#6f7d78", fontSize: 10 },
  saveButton: {
    minHeight: 50, borderRadius: 15, backgroundColor: "#223f36", flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16,
  },
  saveButtonText: { color: "#ffffff", fontSize: 13, fontWeight: "900" },
  cancelButton: { minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 5 },
  cancelButtonText: { color: "#687671", fontSize: 12, fontWeight: "900" },
  buttonDisabled: { opacity: 0.58 },
});
