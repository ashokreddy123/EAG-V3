import sqlite3
import os
from datetime import datetime

DB_FILE = "tracking.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    # Table for app usage logs
    c.execute('''
        CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            type TEXT,
            name TEXT,
            seconds INTEGER
        )
    ''')
    # Table for deep work logs
    c.execute('''
        CREATE TABLE IF NOT EXISTS deep_work_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT,
            seconds INTEGER
        )
    ''')
    conn.commit()
    conn.close()

def log_usage(category, name, seconds):
    today = datetime.now().strftime('%Y-%m-%d')
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    # Check if entry already exists for today
    c.execute('SELECT id, seconds FROM usage_logs WHERE date=? AND type=? AND name=?', (today, category, name))
    row = c.fetchone()
    if row:
        new_seconds = row[1] + seconds
        c.execute('UPDATE usage_logs SET seconds=? WHERE id=?', (new_seconds, row[0]))
    else:
        c.execute('INSERT INTO usage_logs (date, type, name, seconds) VALUES (?, ?, ?, ?)', (today, category, name, seconds))
        
    conn.commit()
    conn.close()

def log_deep_work(seconds):
    if seconds <= 0: return
    today = datetime.now().strftime('%Y-%m-%d')
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    
    c.execute('SELECT id, seconds FROM deep_work_logs WHERE date=?', (today,))
    row = c.fetchone()
    if row:
        new_seconds = row[1] + seconds
        c.execute('UPDATE deep_work_logs SET seconds=? WHERE id=?', (new_seconds, row[0]))
    else:
        c.execute('INSERT INTO deep_work_logs (date, seconds) VALUES (?, ?)', (today, seconds))
        
    conn.commit()
    conn.close()

def get_stats(time_range="day"):
    # Retrieve all rows
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('SELECT date, type, name, seconds FROM usage_logs')
    usage_rows = c.fetchall()
    c.execute('SELECT date, seconds FROM deep_work_logs')
    deep_work_rows = c.fetchall()
    conn.close()
    
    stats = {
        'usage': [{'date': r[0], 'type': r[1], 'name': r[2], 'seconds': r[3]} for r in usage_rows],
        'deep_work': [{'date': r[0], 'seconds': r[1]} for r in deep_work_rows]
    }
    return stats
