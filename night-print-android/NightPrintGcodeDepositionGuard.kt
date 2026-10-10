package com.u1.slicer

import java.io.File

/**
 * Offline executable G-code sanity. Physical printability remains unproven.
 * Validates nonempty XY material deposition on every reported printed layer
 * and the A1 mini's 180mm by 180mm XY material-deposition bounds.
 */
internal object NightPrintGcodeDepositionGuard {
    data class Metrics(
        val layerCount: Int,
        val depositionMoves: Long,
        val minX: Double,
        val minY: Double,
        val maxX: Double,
        val maxY: Double,
        val gcodeBytes: Long,
    )
    data class Result(val metrics: Metrics?, val issue: String?)
    private val number = Regex("""(?:^|\s)([XYE])([-+]?(?:\d+(?:\.\d*)?|\.\d+))(?=\s|$)""")

    fun audit(gcodePath: String, bedX: Double = 180.0, bedY: Double = 180.0): Result {
        val file = File(gcodePath)
        if (!file.isFile || file.length() < 1024) {
            return Result(null, "ナイト検査: 押出し検査用G-codeがありません。")
        }
        var relativeExtrusion = false
        var absoluteXY = true
        var x: Double? = null
        var y: Double? = null
        var activeLayer = -1
        var extrusionOnLayer = 0
        var deposited = 0L
        var minX = Double.POSITIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        var missingLayer = false
        fun bad(s: String) = Result(null, "ナイト検査: $s 印刷を中止してください。")
        try {
            file.useLines { lines ->
                for (raw in lines) {
                    val s = raw.substringBefore(';').trim()
                    val comment = raw.trim()
                    if (comment == ";LAYER_CHANGE") {
                        if (activeLayer >= 0 && extrusionOnLayer <= 0) {
                            missingLayer = true
                            break
                        }
                        activeLayer++
                        extrusionOnLayer = 0
                        continue
                    }
                    if (s == "M83") { relativeExtrusion = true; continue }
                    if (s == "M82") { relativeExtrusion = false; continue }
                    if (s == "G90") { absoluteXY = true; continue }
                    if (s == "G91") { absoluteXY = false; continue }
                    if (!s.startsWith("G1 ") && !s.startsWith("G0 ")) continue
                    val vals = number.findAll(s).associate {
                        it.groupValues[1] to it.groupValues[2].toDouble()
                    }
                    if (activeLayer < 0) {
                        if (absoluteXY) {
                            x = vals["X"] ?: x
                            y = vals["Y"] ?: y
                        }
                        continue
                    }
                    if (!absoluteXY) {
                        // Bambu end-G-code may contain harmless G91 Z-only
                        // travel after the final layer. Reject only actual
                        // positive XY material deposition in relative mode.
                        val eRelative = vals["E"] ?: 0.0
                        if (s.startsWith("G1 ") && eRelative > 0.0 &&
                            (vals.containsKey("X") || vals.containsKey("Y"))) {
                            return bad("積層中に相対XY押出しが使われています。")
                        }
                        continue
                    }
                    if (vals.containsKey("X")) x = vals["X"]
                    if (vals.containsKey("Y")) y = vals["Y"]
                    val e = vals["E"]
                    if (s.startsWith("G1 ") && e != null && e > 0.0 &&
                        (vals.containsKey("X") || vals.containsKey("Y"))) {
                        if (!relativeExtrusion) return bad("積層中のE座標形式が違います。")
                        val xx = x ?: return bad("積層中のX座標が不明です。")
                        val yy = y ?: return bad("積層中のY座標が不明です。")
                        if (!xx.isFinite() || !yy.isFinite() ||
                            xx < -0.01 || xx > bedX + 0.01 ||
                            yy < -0.01 || yy > bedY + 0.01) {
                            return bad("造形範囲外に押出しがあります X=$xx Y=$yy")
                        }
                        extrusionOnLayer++
                        deposited++
                        minX = minOf(minX, xx)
                        minY = minOf(minY, yy)
                        maxX = maxOf(maxX, xx)
                        maxY = maxOf(maxY, yy)
                    }
                }
            }
            if (missingLayer || (activeLayer >= 0 && extrusionOnLayer <= 0)) {
                return bad("押出しのない積層が見つかりました。")
            }
            if (activeLayer < 1 || deposited <= 0 ||
                !minX.isFinite() || !maxX.isFinite()) {
                return bad("実際のXY押出しを確認できません。")
            }
            return Result(Metrics(activeLayer+1,deposited,minX,minY,maxX,maxY,file.length()), null)
        } catch (ex: Exception) {
            return bad("押出し検査で例外が発生しました: " + (ex.message ?: "unknown"))
        }
    }
}
