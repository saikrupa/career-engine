from __future__ import annotations

import sqlite3

import pandas as pd
import streamlit as st

st.set_page_config(page_title="Career Engine Dashboard", layout="wide")
st.title("Career Engine Dashboard")

conn = sqlite3.connect("db/jobs.db")
df = pd.read_sql_query("SELECT * FROM jobs ORDER BY timestamp DESC", conn)
conn.close()

if df.empty:
    st.info("No data yet. Run the pipeline first.")
    st.stop()

c1, c2, c3, c4 = st.columns(4)
c1.metric("Total", len(df))
c2.metric("Applied", int((df["status"] == "applied").sum()))
c3.metric("Saved", int((df["status"] == "saved").sum()))
c4.metric("Skipped", int((df["status"] == "skipped").sum()))

st.subheader("Score Distribution")
st.bar_chart(df["score"])

st.subheader("Recent Jobs")
st.dataframe(df[["title", "company", "status", "score", "source", "timestamp"]], use_container_width=True)
