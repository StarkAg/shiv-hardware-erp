package `in`.shivhardware.order

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * Shiv Order: the door order for the "Shiv Hardware" WhatsApp group.
 *
 * The bill at the counter has the doors with sizes and rates; the group gets
 * them without rates, one line each, as Tony types them by hand:
 *
 *   3D MT158 78⅜x37²/⁸ - 1 pc
 *
 * Pick the model, type the height and width inches, tap the eighths, set the
 * pieces, Add. Other things (fitting, magnets) go in as a plain line. Send to
 * group, Yes: it goes from the Shop WhatsApp (79705 50954, on Railway), no
 * WhatsApp to open. What is being made is kept if the app is closed.
 */
class MainActivity : Activity() {

    /** One line of the order: a door, or a plain line typed as it is. */
    private data class Line(
        val model: String = "", val h: Int = 0, val h8: Int = 0, val w: Int = 0, val w8: Int = 0,
        val qty: Int = 1, val text: String = "",
    ) {
        val isDoor get() = text.isEmpty()
        fun say(): String =
            if (isDoor) "$model ${inches(h, h8)}x${inches(w, w8)} - $qty pc" else text

        fun toJson(): JSONObject = JSONObject().put("model", model).put("h", h).put("h8", h8).put("w", w).put("w8", w8)
            .put("qty", qty).put("text", text)

        companion object {
            fun of(o: JSONObject) = Line(o.optString("model"), o.optInt("h"), o.optInt("h8"), o.optInt("w"), o.optInt("w8"),
                o.optInt("qty", 1), o.optString("text"))
        }
    }

    private val lines = mutableListOf<Line>()
    private var models = mutableListOf<String>()
    private var h8 = 0
    private var w8 = 0
    private var qty = 1
    private var sending = false

    private lateinit var root: FrameLayout
    private lateinit var prefs: android.content.SharedPreferences
    private var modelBox: EditText? = null
    private var modelChips: LinearLayout? = null
    private var hBox: EditText? = null
    private var wBox: EditText? = null
    private var h8Row: LinearLayout? = null
    private var w8Row: LinearLayout? = null
    private var qtyText: TextView? = null
    private var otherBox: EditText? = null
    private var party: EditText? = null
    private var list: LinearLayout? = null
    private var preview: TextView? = null
    private var status: TextView? = null
    private var sendButton: Button? = null

    private val updater by lazy { Updater(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("order", Context.MODE_PRIVATE)
        load()
        WindowCompat.setDecorFitsSystemWindows(window, false)
        root = FrameLayout(this).apply { setBackgroundColor(WHITE) }
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
        // Clear of the bars and of the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        if (Shop.token(this) == null) showPin() else showOrder()
    }

    override fun onResume() {
        super.onResume()
        updater.check()
    }

    /* ── kept on the phone ───────────────────────────────────────────────── */

    private fun load() {
        try {
            val a = JSONArray(prefs.getString("lines", "[]"))
            for (i in 0 until a.length()) lines += Line.of(a.getJSONObject(i))
        } catch (e: Exception) { }
        models = try {
            val a = JSONArray(prefs.getString("models", null) ?: "[]")
            MutableList(a.length()) { a.getString(it) }
        } catch (e: Exception) { mutableListOf() }
        if (models.isEmpty()) models = DEFAULT_MODELS.toMutableList()
    }

    private fun save() {
        prefs.edit()
            .putString("lines", JSONArray(lines.map { it.toJson() }).toString())
            .putString("models", JSONArray(models).toString())
            .putString("party", party?.text?.toString() ?: prefs.getString("party", ""))
            .apply()
    }

    /** The newest model first, so the one in use is always the first chip. */
    private fun remember(model: String) {
        models.removeAll { it.equals(model, ignoreCase = true) }
        models.add(0, model)
        while (models.size > 16) models.removeAt(models.size - 1)
    }

    /* ── the PIN, once ───────────────────────────────────────────────────── */

    private fun showPin() {
        root.removeAllViews()
        val col = column()
        col.addView(title("Shiv Order"))
        col.addView(small("Door orders to the Shiv Hardware WhatsApp group, from the Shop WhatsApp.\n\nEnter the shop PIN once to trust this phone."), gap(8))
        val pin = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
            hint = "Shop PIN"
            textSize = 24f
            gravity = Gravity.CENTER
            background = box(WHITE, HAIRLINE)
            setPadding(dp(16), dp(14), dp(16), dp(14))
        }
        col.addView(pin, gap(24))
        val note = small("")
        val go = button("Trust this phone", BLUE, WHITE)
        go.setOnClickListener {
            val typed = pin.text.toString().trim()
            if (typed.isEmpty()) return@setOnClickListener
            go.isEnabled = false
            note.text = "Checking…"
            note.setTextColor(GREY)
            thread(name = "pair") {
                val error = try { Shop.pair(this, typed) } catch (e: Exception) { "No internet, or the shop's server is down. Try again." }
                runOnUiThread {
                    if (error == null) { hideKeyboard(pin); showOrder() }
                    else { go.isEnabled = true; note.text = error; note.setTextColor(RED) }
                }
            }
        }
        col.addView(go, gap(16))
        col.addView(note, gap(12))
        root.addView(ScrollView(this).apply { addView(col) })
        pin.requestFocus()
        showKeyboard(pin)
    }

    /* ── the order ───────────────────────────────────────────────────────── */

    private fun showOrder() {
        root.removeAllViews()
        val page = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val col = column()

        col.addView(title("Door order"))
        col.addView(small("Goes to the Shiv Hardware group from the Shop WhatsApp. No rates."), gap(2))

        // Model
        col.addView(label("Model"), gap(18))
        modelChips = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        col.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(modelChips) }, gap(6))
        modelBox = field("Model, e.g. 3D MT158", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS).apply {
            setText(models.firstOrNull() ?: "")
            imeOptions = EditorInfo.IME_ACTION_NEXT
            onChange { drawModelChips() }
        }
        col.addView(modelBox, gap(8))

        // Height and width: inches, then the eighths
        hBox = inchBox("Height")
        wBox = inchBox("Width")
        h8Row = eighths { h8 = it; drawEighths() }
        w8Row = eighths { w8 = it; drawEighths() }
        col.addView(sizeBlock("Height", hBox!!, h8Row!!), gap(18))
        col.addView(sizeBlock("Width", wBox!!, w8Row!!), gap(14))
        // Two figures is a whole door size: go straight on.
        hBox!!.onChange { if (it.length == 2 && hBox!!.hasFocus()) wBox!!.requestFocus() }
        wBox!!.onChange { if (it.length == 2 && wBox!!.hasFocus()) hideKeyboard(wBox!!) }
        hBox!!.imeOptions = EditorInfo.IME_ACTION_NEXT
        wBox!!.imeOptions = EditorInfo.IME_ACTION_DONE

        // Pieces
        val qtyRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        qtyRow.addView(label("Pieces"), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        qtyRow.addView(button("−", KEY_GREY, INK).apply { textSize = 26f; setOnClickListener { if (qty > 1) { qty--; drawQty() } } },
            LinearLayout.LayoutParams(dp(64), dp(60)))
        qtyText = TextView(this).apply { textSize = 26f; setTypeface(Typeface.DEFAULT, Typeface.BOLD); setTextColor(INK); gravity = Gravity.CENTER }
        qtyRow.addView(qtyText, LinearLayout.LayoutParams(dp(72), ViewGroup.LayoutParams.WRAP_CONTENT))
        qtyRow.addView(button("+", KEY_GREY, INK).apply { textSize = 26f; setOnClickListener { qty++; drawQty() } },
            LinearLayout.LayoutParams(dp(64), dp(60)))
        col.addView(qtyRow, gap(16))

        col.addView(button("Add door", BLUE, WHITE).apply { setOnClickListener { addDoor() } }, gap(16))

        // Anything else, as a plain line
        col.addView(label("Other line"), gap(22))
        val otherRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        otherBox = field("e.g. Fitting 7 item - 2 set", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES).apply {
            imeOptions = EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, _, _ -> addOther(); true }
        }
        otherRow.addView(otherBox, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(10) })
        otherRow.addView(button("Add", KEY_GREY, INK).apply { setOnClickListener { addOther() } }, LinearLayout.LayoutParams(dp(84), dp(60)))
        col.addView(otherRow, gap(6))

        // The order so far
        col.addView(label("The order"), gap(26))
        list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        col.addView(list, gap(6))

        party = field("Party name on top (optional)", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS).apply {
            setText(prefs.getString("party", ""))
            onChange { save(); drawPreview() }
        }
        col.addView(party, gap(14))

        col.addView(label("This will go to the group"), gap(22))
        preview = TextView(this).apply {
            textSize = 17f
            setTextColor(INK)
            setLineSpacing(0f, 1.15f)
            setTextIsSelectable(true)
            background = box(KEY_GREY, KEY_GREY)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        col.addView(preview, gap(6))

        status = small("")
        col.addView(status, gap(12))

        page.addView(ScrollView(this).apply { addView(col); isFillViewport = true },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        // Clear and Send, always in reach at the foot of the screen.
        val foot = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(20), dp(10), dp(20), dp(14))
            setBackgroundColor(WHITE)
        }
        foot.addView(button("Clear", KEY_GREY, INK).apply { setOnClickListener { askClear() } },
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(10) })
        sendButton = button("Send to group", GREEN, WHITE).apply { setOnClickListener { confirm() } }
        foot.addView(sendButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f))
        page.addView(View(this).apply { setBackgroundColor(HAIRLINE) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)))
        page.addView(foot)

        root.addView(page)
        drawModelChips(); drawEighths(); drawQty(); drawList()
    }

    private fun addDoor() {
        val model = modelBox?.text?.toString()?.trim()?.replace(Regex("\\s+"), " ").orEmpty()
        val h = hBox?.text?.toString()?.toIntOrNull() ?: 0
        val w = wBox?.text?.toString()?.toIntOrNull() ?: 0
        when {
            model.isEmpty() -> { say("Pick or type the model.", RED); modelBox?.requestFocus(); return }
            h <= 0 -> { say("Type the height in inches.", RED); hBox?.requestFocus(); showKeyboard(hBox!!); return }
            w <= 0 -> { say("Type the width in inches.", RED); wBox?.requestFocus(); showKeyboard(wBox!!); return }
        }
        lines += Line(model, h, h8, w, w8, qty)
        remember(model)
        // Ready for the next door of the same model.
        hBox?.setText(""); wBox?.setText("")
        h8 = 0; w8 = 0; qty = 1
        drawModelChips(); drawEighths(); drawQty(); drawList()
        say("Added. Next door: type its height.", GREY)
        hBox?.requestFocus()
        save()
    }

    private fun addOther() {
        val text = otherBox?.text?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        lines += Line(text = text)
        otherBox?.setText("")
        otherBox?.let { hideKeyboard(it) }
        drawList()
        save()
    }

    /** A door tapped in the list comes back up to be put right. */
    private fun edit(i: Int) {
        val line = lines.removeAt(i)
        if (line.isDoor) {
            modelBox?.setText(line.model)
            hBox?.setText(line.h.toString()); wBox?.setText(line.w.toString())
            h8 = line.h8; w8 = line.w8; qty = line.qty
            drawEighths(); drawQty()
            say("Put it right, then Add door.", GREY)
            (root.getChildAt(0) as? LinearLayout)?.getChildAt(0)?.let { (it as? ScrollView)?.smoothScrollTo(0, 0) }
        } else {
            otherBox?.setText(line.text)
            otherBox?.requestFocus()
        }
        drawList()
        save()
    }

    /* ── drawing ─────────────────────────────────────────────────────────── */

    private fun drawModelChips() {
        val row = modelChips ?: return
        row.removeAllViews()
        val current = modelBox?.text?.toString()?.trim().orEmpty()
        models.forEach { m ->
            val on = m.equals(current, ignoreCase = true)
            row.addView(chip(m, on) { modelBox?.setText(m); modelBox?.setSelection(m.length) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52)).apply { marginEnd = dp(8) })
        }
    }

    private fun drawEighths() {
        listOf(h8Row to h8, w8Row to w8).forEach { (row, picked) ->
            row ?: return@forEach
            for (i in 0 until row.childCount) {
                val c = row.getChildAt(i) as TextView
                paintChip(c, i == picked)
            }
        }
    }

    private fun drawQty() { qtyText?.text = qty.toString() }

    private fun drawList() {
        val box = list ?: return
        box.removeAllViews()
        if (lines.isEmpty()) box.addView(small("Nothing yet. Add the first door above."))
        lines.forEachIndexed { i, line ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = box(WHITE, HAIRLINE)
                setPadding(dp(12), dp(4), dp(4), dp(4))
            }
            row.addView(TextView(this).apply {
                text = line.say()
                textSize = 18f
                setTextColor(INK)
                setOnClickListener { if (!sending) edit(i) }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(TextView(this).apply {
                text = "✕"
                textSize = 18f
                setTypeface(Typeface.DEFAULT, Typeface.BOLD)
                setTextColor(RED)
                gravity = Gravity.CENTER
                contentDescription = "Remove"
                setOnClickListener { if (!sending) { lines.removeAt(i); drawList(); save() } }
            }, LinearLayout.LayoutParams(dp(52), dp(52)))
            box.addView(row, gap(if (i == 0) 0 else 8))
        }
        drawPreview()
    }

    private fun message(): String {
        val name = party?.text?.toString()?.trim().orEmpty()
        val body = lines.joinToString("\n") { it.say() }
        return if (name.isNotEmpty() && body.isNotEmpty()) "$name\n$body" else body
    }

    private fun drawPreview() {
        val text = message()
        preview?.text = text.ifEmpty { "—" }
        sendButton?.isEnabled = lines.isNotEmpty() && !sending
        sendButton?.alpha = if (sendButton?.isEnabled == true) 1f else 0.45f
    }

    /* ── sending ─────────────────────────────────────────────────────────── */

    private fun confirm() {
        val text = message()
        if (text.isEmpty()) return
        currentFocus?.let { hideKeyboard(it) }
        AlertDialog.Builder(this)
            .setTitle("Send to Shiv Hardware group?")
            .setMessage(text)
            .setPositiveButton("Yes, send") { _, _ -> send(text) }
            .setNegativeButton("No", null)
            .show()
    }

    private fun send(text: String) {
        val token = Shop.token(this) ?: return showPin()
        sending = true
        drawPreview()
        say("Sending…", GREY)
        thread(name = "send") {
            val error: Exception? = try { Shop.sendText(token, text); null } catch (e: Exception) { e }
            runOnUiThread {
                sending = false
                when (error) {
                    null -> {
                        prefs.edit().putString("lastSent", text).apply()
                        lines.clear()
                        party?.setText("")
                        drawList()
                        save()
                        say("Sent to the group ✓", GREEN)
                    }
                    is Shop.Untrusted -> { Shop.forget(this); showPin() }
                    else -> {
                        drawPreview()
                        say("Not sent: ${error.message ?: "no internet"} Tap Send to try again.", RED)
                    }
                }
            }
        }
    }

    private fun askClear() {
        if (lines.isEmpty()) {
            // Nothing made: offer the last order sent back, to send again or change.
            val last = prefs.getString("lastSent", null) ?: return
            AlertDialog.Builder(this)
                .setTitle("Last order sent")
                .setMessage(last)
                .setPositiveButton("OK", null)
                .show()
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Clear this order?")
            .setMessage("${lines.size} line${if (lines.size == 1) "" else "s"} will be taken off.")
            .setPositiveButton("Clear") { _, _ -> lines.clear(); party?.setText(""); drawList(); save(); say("", GREY) }
            .setNegativeButton("No", null)
            .show()
    }

    private fun say(text: String, color: Int) {
        val s = status ?: return
        s.text = text
        s.setTextColor(color)
        s.textSize = if (color == GREY) 15f else 17f
    }

    /* ── pieces of the screen, in the Signs look (DESIGN.md) ─────────────── */

    private fun inchBox(hint: String) = field(hint, InputType.TYPE_CLASS_NUMBER).apply {
        textSize = 28f
        gravity = Gravity.CENTER
        filters = arrayOf(android.text.InputFilter.LengthFilter(3))
    }

    private fun sizeBlock(name: String, inches: EditText, eighths: LinearLayout) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        val top = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(label(name), LinearLayout.LayoutParams(dp(84), ViewGroup.LayoutParams.WRAP_CONTENT))
        top.addView(inches, LinearLayout.LayoutParams(dp(110), ViewGroup.LayoutParams.WRAP_CONTENT))
        top.addView(small("  inch  +  eighths:"))
        addView(top)
        addView(eighths, gap(6))
    }

    /** 0 to 7 eighths of an inch, one tap. */
    private fun eighths(onPick: (Int) -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        for (i in 0..7) {
            val c = TextView(this@MainActivity).apply {
                text = if (i == 0) "0" else EIGHTHS[i]
                textSize = 19f
                gravity = Gravity.CENTER
                setOnClickListener { onPick(i) }
            }
            addView(c, LinearLayout.LayoutParams(0, dp(52), 1f).apply { if (i < 7) marginEnd = dp(5) })
        }
    }

    private fun chip(text: String, on: Boolean, onTap: () -> Unit) = TextView(this).apply {
        this.text = text
        textSize = 17f
        gravity = Gravity.CENTER
        setPadding(dp(16), 0, dp(16), 0)
        setOnClickListener { onTap() }
        paintChip(this, on)
    }

    /** Picked is blue (the one that will be used), not picked is a quiet grey key. */
    private fun paintChip(c: TextView, on: Boolean) {
        c.background = GradientDrawable().apply {
            setColor(if (on) BLUE else KEY_GREY)
            cornerRadius = dp(6).toFloat()
        }
        c.setTextColor(if (on) WHITE else INK)
        c.setTypeface(Typeface.DEFAULT, if (on) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun field(hint: String, type: Int) = EditText(this).apply {
        this.hint = hint
        inputType = type
        textSize = 18f
        setSingleLine()
        background = box(WHITE, HAIRLINE)
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }

    private fun column() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(20), dp(20), dp(20), dp(20))
    }

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        textSize = 26f
        setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        setTextColor(INK)
    }

    private fun label(text: String) = TextView(this).apply {
        this.text = text
        textSize = 16f
        setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        setTextColor(INK)
    }

    private fun small(text: String) = TextView(this).apply {
        this.text = text
        textSize = 15f
        setTextColor(GREY)
    }

    /** A Signs button: flat colour, a darker foot, big enough for a thumb. */
    private fun button(text: String, fill: Int, ink: Int) = Button(this).apply {
        this.text = text
        isAllCaps = false
        textSize = 19f
        setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        setTextColor(ink)
        minHeight = dp(60)
        stateListAnimator = null
        val foot = GradientDrawable().apply { setColor(if (fill == KEY_GREY) HAIRLINE else darker(fill)); cornerRadius = dp(6).toFloat() }
        val face = GradientDrawable().apply { setColor(fill); cornerRadius = dp(6).toFloat() }
        background = LayerDrawable(arrayOf(foot, face)).apply { setLayerInset(1, 0, 0, 0, dp(4)) }
    }

    private fun box(fill: Int, line: Int) = GradientDrawable().apply {
        setColor(fill)
        setStroke(dp(2), line)
        cornerRadius = dp(6).toFloat()
    }

    private fun gap(top: Int) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun darker(c: Int): Int {
        val f = 0.72f
        return android.graphics.Color.rgb((android.graphics.Color.red(c) * f).toInt(), (android.graphics.Color.green(c) * f).toInt(), (android.graphics.Color.blue(c) * f).toInt())
    }

    private fun EditText.onChange(block: (String) -> Unit) = addTextChangedListener(object : TextWatcher {
        override fun afterTextChanged(s: Editable?) = block(s?.toString() ?: "")
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
    })

    private fun hideKeyboard(v: View) {
        (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(v.windowToken, 0)
    }

    private fun showKeyboard(v: View) {
        v.post { (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(v, InputMethodManager.SHOW_IMPLICIT) }
    }

    companion object {
        /** The eighths as Tony types them: ⅛ ⅜ ⅝ ⅞ have their own sign; 2, 4 and 6 eighths stay eighths. */
        val EIGHTHS = arrayOf("", "⅛", "²/⁸", "⅜", "⁴/⁸", "⅝", "⁶/⁸", "⅞")

        /** 78 and 3 eighths → "78⅜"; a whole inch stays "78". */
        fun inches(whole: Int, eighths: Int) = "$whole${EIGHTHS.getOrElse(eighths) { "" }}"

        /** The models on the bills so far; new ones are remembered as they are typed. */
        val DEFAULT_MODELS = listOf("3D MT158", "3D 138", "3D 110", "AC 1.2mm", "AD 1.2mm")

        private const val WHITE = 0xFFFFFFFF.toInt()
        private const val INK = 0xFF0E1318.toInt()
        private const val GREY = 0xFF4C5660.toInt()
        private const val HAIRLINE = 0xFFC9CFD5.toInt()
        private const val KEY_GREY = 0xFFEDF0F3.toInt()
        private const val BLUE = 0xFF0054B4.toInt()
        private const val GREEN = 0xFF007A3D.toInt()
        private const val RED = 0xFFB3202A.toInt()
    }
}
