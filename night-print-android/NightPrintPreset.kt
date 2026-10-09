package com.u1.slicer

import com.u1.slicer.data.OverrideMode
import com.u1.slicer.data.OverrideValue
import com.u1.slicer.data.SlicingOverrides
import org.json.JSONObject

/**
 * NIGHT PRINT v1: only known process keys, validated before any setting changes.
 * Cannot send a print job, alter printer connection info, or run G-code.
 */
data class NightPrintPreset(
    val name: String,
    val layerHeight: Float,
    val wallLoops: Int,
    val infillPercent: Int,
    val topShellLayers: Int,
    val bottomShellLayers: Int,
    val infillPattern: String
) {
    fun applyTo(old: SlicingOverrides): SlicingOverrides = old.copy(
        layerHeight = OverrideValue(OverrideMode.OVERRIDE, layerHeight),
        wallCount = OverrideValue(OverrideMode.OVERRIDE, wallLoops),
        infillDensity = OverrideValue(OverrideMode.OVERRIDE, infillPercent / 100f),
        topShellLayers = OverrideValue(OverrideMode.OVERRIDE, topShellLayers),
        bottomShellLayers = OverrideValue(OverrideMode.OVERRIDE, bottomShellLayers),
        infillPattern = OverrideValue(OverrideMode.OVERRIDE, infillPattern)
    )

    fun summary(): String =
        "$name\n壁 ${wallLoops}周 / 充填 ${infillPercent}% / 積層 ${layerHeight}mm\n上面 ${topShellLayers}層・底面 ${bottomShellLayers}層\n印刷開始はしません。"

    companion object {
        fun parse(text: String): NightPrintPreset {
            require(text.length in 20..3000) { "設定データの長さが不正です" }
            val p = JSONObject(text)
            require(p.optString("schema") == "nightprint/v1") { "対応していないナイト設定です" }
            val name = p.optString("name", "NIGHT PRINT").take(80)
            val h = p.getDouble("layer_height").toFloat()
            val w = p.getInt("wall_loops")
            val d = p.getInt("sparse_infill_density")
            val top = p.getInt("top_shell_layers")
            val bottom = p.getInt("bottom_shell_layers")
            val pattern = p.optString("sparse_infill_pattern", "gyroid")
            require(h.isFinite() && h in 0.08f..0.32f) { "積層高さが範囲外です" }
            require(w in 2..10) { "壁の数が範囲外です" }
            require(d in 10..100) { "充填率が範囲外です" }
            require(top in 2..12 && bottom in 2..12) { "上下面の層数が範囲外です" }
            require(pattern in setOf("gyroid", "grid", "rectilinear", "cubic")) { "充填パターンが不正です" }
            return NightPrintPreset(name, h, w, d, top, bottom, pattern)
        }
    }
}
