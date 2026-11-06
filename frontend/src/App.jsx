
import { useState } from "react";
import "./App.css";

const initialTasks = [
  {
    id: 1,
    title: "Linear Algebra Homework",
    course: "MATH 248",
    dueDate: "2026-10-21",
    source: "Brightspace",
    completed: false,
  },
  {
    id: 2,
    title: "Senior Project Design",
    course: "CMSI 4071",
    dueDate: "2026-10-23",
    source: "Professor Website",
    completed: false,
  },
  {
    id: 3,
    title: "Cybersecurity Research Paper",
    course: "CMSI",
    dueDate: "2026-10-26",
    source: "Brightspace",
    completed: false,
  },
];

const initialImports = [
  {
    id: 101,
    title: "Register for Career Fair",
    course: "Career Center",
    dueDate: "2026-10-28",
    source: "University Website",
  },
  {
    id: 102,
    title: "Submit Course Reflection",
    course: "CMSI 4071",
    dueDate: "2026-10-30",
    source: "Professor Website",
  },
];

const initialSources = [
  { name: "Brightspace", status: "Demo source" },
  { name: "Professor Websites", status: "Demo source" },
  { name: "University Websites", status: "Demo source" },
];

function formatDate(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" }
  );
}

function App() {
  const [tasks, setTasks] = useState(initialTasks);
  const [imports, setImports] = useState(initialImports);
  const [activePage, setActivePage] = useState("Dashboard");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");

  const completedCount = tasks.filter((task) => task.completed).length;
  const sortedTasks = [...tasks].sort((a, b) =>
    a.dueDate.localeCompare(b.dueDate)
  );

  const visibleTasks = sortedTasks.filter((task) => {
    if (selectedDate && task.dueDate !== selectedDate) return false;
    if (activePage === "My Tasks") return !task.completed;
    return true;
  });

  function toggleTask(id) {
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? { ...task, completed: !task.completed }
          : task
      )
    );
  }

  function addTask() {
    const title = window.prompt("Assignment title:");
    if (!title?.trim()) return;

    const course = window.prompt("Course or category:", "Personal");
    if (course === null) return;

    const dueDate = window.prompt("Due date (YYYY-MM-DD):");
    if (!dueDate) return;

    const parsed = new Date(`${dueDate}T12:00:00`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
      Number.isNaN(parsed.getTime()) ||
      [
        parsed.getFullYear(),
        String(parsed.getMonth() + 1).padStart(2, "0"),
        String(parsed.getDate()).padStart(2, "0"),
      ].join("-") !== dueDate
    ) {
      window.alert("Please enter a valid date (YYYY-MM-DD).");
      return;
    }

    setTasks((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        title: title.trim(),
        course: course?.trim() || "Personal",
        dueDate,
        source: "Manually Added",
        completed: false,
      },
    ]);
  }

  function approveImport(importedTask) {
    setTasks((current) => [
      ...current,
      {
        ...importedTask,
        completed: false,
      },
    ]);
    setImports((current) =>
      current.filter((item) => item.id !== importedTask.id)
    );
  }

  function rejectImport(id) {
    setImports((current) =>
      current.filter((item) => item.id !== id)
    );
  }

  function changeMonth(amount) {
    setCalendarMonth(
      new Date(
        calendarMonth.getFullYear(),
        calendarMonth.getMonth() + amount,
        1
      )
    );
    setSelectedDate(null);
  }

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();

  const calendarDays = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function dateKey(day) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const menuItems = [
    "Dashboard",
    "My Tasks",
    "Review Imports",
    "Sources",
  ];

  return (
    <div className="app-layout">
      {/* LEFT NAVIGATION */}
      <aside className="sidebar">
        <h1 className="logo">Gather<span>.</span></h1>

        <p className="sidebar-label">WORKSPACE</p>

        <nav className="navigation">
          {menuItems.map((item) => (
            <button
              key={item}
              className={
                activePage === item
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => {
                setActivePage(item);
                setSelectedDate(null);
              }}
            >
              <span>{item}</span>
              {item === "Review Imports" && imports.length > 0 && (
                <span className="nav-count">{imports.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <strong>Student Workspace</strong>
          <p>Gather Project</p>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        <header className="page-header">
          <div>
            <p className="eyebrow">YOUR WORKSPACE</p>
            <h1>{activePage}</h1>
            <p className="subtitle">
              Your assignments, deadlines, and tasks in one place.
            </p>
          </div>

          <button className="add-button" onClick={addTask}>
            + Add Task
          </button>
        </header>

        {(activePage === "Dashboard" ||
          activePage === "My Tasks") && (
          <>
            <section className="stats-grid">
              <div className="stat-card">
                <span>Total Tasks</span>
                <strong>{tasks.length}</strong>
              </div>

              <div className="stat-card">
                <span>To Do</span>
                <strong>{tasks.length - completedCount}</strong>
              </div>

              <div className="stat-card">
                <span>Completed</span>
                <strong>{completedCount}</strong>
              </div>
            </section>

            {imports.length > 0 && (
              <div className="import-banner">
                <div>
                  <strong>
                    {imports.length} assignments awaiting review
                  </strong>
                  <p>
                    Review suggested tasks before adding them
                    to your dashboard.
                  </p>
                </div>
                <button onClick={() => setActivePage("Review Imports")}>
                  Review now
                </button>
              </div>
            )}

            <section className="content-card">
              <div className="section-heading">
                <h2>
                  {selectedDate
                    ? `Assignments for ${formatDate(selectedDate)}`
                    : "My Assignments"}
                </h2>

                {selectedDate && (
                  <button
                    className="text-button"
                    onClick={() => setSelectedDate(null)}
                  >
                    Show all
                  </button>
                )}
              </div>

              {visibleTasks.length === 0 ? (
                <p className="empty-state">
                  No assignments to display.
                </p>
              ) : (
                visibleTasks.map((task) => (
                  <div className="assignment-card" key={task.id}>
                    <input
                      type="checkbox"
                      checked={task.completed}
                      onChange={() => toggleTask(task.id)}
                      aria-label={`Complete ${task.title}`}
                    />

                    <div className="assignment-details">
                      <h3 className={task.completed ? "done" : ""}>
                        {task.title}
                      </h3>
                      <p>
                        {task.course} · {task.source}
                      </p>
                    </div>

                    <span className="assignment-date">
                      {formatDate(task.dueDate)}
                    </span>
                  </div>
                ))
              )}
            </section>
          </>
        )}

        {activePage === "Review Imports" && (
          <section className="content-card">
            <div className="section-heading">
              <h2>Pending Assignments</h2>
              <span className="pending-label">
                {imports.length} pending
              </span>
            </div>

            <p className="section-description">
              These are sample tasks representing information
              that Gather could collect from external websites.
              Approve or reject each task before adding it
              to your dashboard.
            </p>

            {imports.length === 0 ? (
              <p className="empty-state">
                All caught up! No assignments awaiting review.
              </p>
            ) : (
              imports.map((task) => (
                <div className="review-card" key={task.id}>
                  <div>
                    <h3>{task.title}</h3>
                    <p>{task.course} · {task.source}</p>
                    <span>Due {formatDate(task.dueDate)}</span>
                  </div>

                  <div className="review-actions">
                    <button
                      className="approve-button"
                      onClick={() => approveImport(task)}
                    >
                      Approve
                    </button>
                    <button
                      className="reject-button"
                      onClick={() => rejectImport(task.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {activePage === "Sources" && (
          <section className="content-card">
            <h2>External Sources</h2>
            <p className="section-description">
              Gather will retrieve information from authorized
              university websites and APIs. The sources below
              are placeholders and are not connected yet.
            </p>

            {initialSources.map((source) => (
              <div className="source-card" key={source.name}>
                <div>
                  <h3>{source.name}</h3>
                  <p>Assignment and deadline information</p>
                </div>
                <span className="source-status">
                  {source.status}
                </span>
              </div>
            ))}
          </section>
        )}
      </main>

      {/* CALENDAR TOGGLE */}
      <button
        className={`calendar-toggle ${calendarOpen ? "open" : ""}`}
        onClick={() => setCalendarOpen((open) => !open)}
        aria-label={calendarOpen ? "Close calendar" : "Open calendar"}
        aria-expanded={calendarOpen}
        aria-controls="gather-calendar"
      >
        <span>{calendarOpen ? "→" : "📅"}</span>
        {!calendarOpen && <span>Calendar</span>}
      </button>

      {/* SLIDING RIGHT CALENDAR */}
      <aside
        id="gather-calendar"
        className={`calendar-sidebar ${calendarOpen ? "open" : ""}`}
        aria-hidden={!calendarOpen}
        inert={!calendarOpen}
      >
        <div className="calendar-heading">
          <h2>Calendar</h2>
          <p>Stay on top of your deadlines.</p>
        </div>

        <div className="calendar-box">
          <div className="month-header">
            <h3>
              {calendarMonth.toLocaleDateString("en-US", {
                month: "long",
                year: "numeric",
              })}
            </h3>

            <div className="month-buttons">
              <button
                onClick={() => changeMonth(-1)}
                aria-label="Previous month"
              >
                ‹
              </button>
              <button
                onClick={() => changeMonth(1)}
                aria-label="Next month"
              >
                ›
              </button>
            </div>
          </div>

          <div className="calendar-grid">
            {["S", "M", "T", "W", "T", "F", "S"].map(
              (day, index) => (
                <span className="weekday" key={index}>
                  {day}
                </span>
              )
            )}

            {calendarDays.map((day, index) => {
              if (!day) {
                return <span key={`empty-${index}`} />;
              }

              const date = dateKey(day);
              const hasTask = tasks.some(
                (task) => task.dueDate === date
              );

              return (
                <button
                  key={date}
                  className={[
                    "calendar-day",
                    date === todayKey ? "today" : "",
                    date === selectedDate ? "selected" : "",
                  ].join(" ")}
                  onClick={() => {
                    setSelectedDate(
                      selectedDate === date ? null : date
                    );
                    setActivePage("Dashboard");
                  }}
                >
                  {day}
                  {hasTask && <span className="task-dot" />}
                </button>
              );
            })}
          </div>
        </div>

        <section className="upcoming-section">
          <h3>Upcoming Deadlines</h3>

          {sortedTasks.filter(
            (task) =>
              !task.completed && task.dueDate >= todayKey
          ).length === 0 ? (
            <p className="empty-state">
              No upcoming deadlines.
            </p>
          ) : (
            sortedTasks
              .filter(
                (task) =>
                  !task.completed && task.dueDate >= todayKey
              )
              .slice(0, 5)
              .map((task) => (
                <div className="upcoming-task" key={task.id}>
                  <span className="upcoming-dot" />
                  <div>
                    <strong>{task.title}</strong>
                    <p>{formatDate(task.dueDate)}</p>
                  </div>
                </div>
              ))
          )}
        </section>
      </aside>
    </div>
  );
}

export default App;
