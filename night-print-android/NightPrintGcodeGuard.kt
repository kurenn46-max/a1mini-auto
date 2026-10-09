package com.u1.slicer

import java.io.File

/**
 * Fail closed for A1 mini PETG when executable startup G-code disagrees
 * with the material/nozzle-temperature values in the sliced profile.
 *
 * Metadata comments alone are NOT sufficient to authorize a print.
 * This audit intentionally does not rewrite printer commands.
 */
internal object NightPrintGcodeGuard {
    private val heater = Regex("""^M10[49]\s+S(\d+(?:\.\d+)?)(?:\s|;|$)""")

    /**
     * Confirms the generated job is truly for the A1 mini, not only
     * cosmetically labeled PETG or produced with the U1 270-mm bed.
     * Printer pairing is not required for this offline check.
     */
    fun checkA1MiniMachine(gcodePath: String): String? {
        val file = File(gcodePath)
        if (!file.isFile) return "ナイト検査: G-codeがありません。"
        var modelOk = false
        var areaOk = false
        return try {
            file.bufferedReader().use { reader ->
                for (line in reader.lineSequence()) {
                    val value = line.trim()
                    if (value.startsWith("; printer_model =")) {
                        modelOk = value.substringAfter("=").trim()
                            .equals("Bambu Lab A1 mini", ignoreCase = true)
                    }
                    if (value.startsWith("; printable_area =") ||
                        value.startsWith("; bed_shape =")) {
                        if (value.contains("180x180")) areaOk = true
                    }
                }
            }
            when {
                !modelOk -> "ナイト検査: A1 mini用のG-codeではありません。印刷を中止してください。"
                !areaOk -> "ナイト検査: A1 miniの180mm造形範囲を確認できません。印刷を中止してください。"
                else -> null
            }
        } catch (_: Exception) {
            "ナイト検査: 機種の確認に失敗しました。印刷を中止してください。"
        }
    }

    /**
     * Fixed-layer process integrity. The V2.8 ring G-code showed 100 UI
     * layers but only 70 actual layer changes, some jumping by 1.2mm.
     * Check executable layer structure, not a UI/header estimate.
     */
    fun checkA1MiniFixedLayers(
        gcodePath: String,
        expectedHeightMm: Float,
        expectedLayerCount: Int? = null,
    ): String? {
        if (!expectedHeightMm.isFinite() || expectedHeightMm !in 0.08f..0.32f) {
            return "ナイト検査: 積層高さの設定が正しくありません。"
        }
        if (expectedLayerCount != null && expectedLayerCount !in 2..200_000) {
            return "ナイト検査: 期待積層数が不正です。"
        }
        val file = File(gcodePath)
        if (!file.isFile) return "ナイト検査: 積層検査用G-codeがありません。"
        val expected = expectedHeightMm.toDouble()
        val tolerance = maxOf(0.035, expected * 0.16)
        var prevZ: Double? = null
        var maxZ: Double? = null
        var layerCount = 0
        var waitingForZ = false
        return try {
            file.bufferedReader().use { reader ->
                for (raw in reader.lineSequence()) {
                    val s = raw.trim()
                    if (s.startsWith("; max_z_height:")) {
                        maxZ = s.substringAfter(":").trim().toDoubleOrNull()
                    }
                    if (s == ";LAYER_CHANGE") {
                        if (waitingForZ) {
                            return "ナイト検査: 積層Z座標が欠けています。印刷を中止してください。"
                        }
                        waitingForZ = true
                        continue
                    }
                    if (!waitingForZ || !s.startsWith(";Z:")) continue
                    val z = s.substringAfter(":").trim().toDoubleOrNull()
                        ?: return "ナイト検査: 積層Zが数値ではありません。"
                    if (!z.isFinite()) return "ナイト検査: 積層Zが不正です。"
                    val step = z - (prevZ ?: 0.0)
                    if (step <= 0.0 || kotlin.math.abs(step - expected) > tolerance) {
                        return "ナイト検査: 積層間隔 " +
                            String.format(java.util.Locale.US, "%.2f", step) +
                            "mm が設定 " +
                            String.format(java.util.Locale.US, "%.2f", expected) +
                            "mm と不一致。印刷を中止してください。"
                    }
                    prevZ = z
                    layerCount++
                    waitingForZ = false
                }
            }
            when {
                waitingForZ || layerCount < 2 || prevZ == null ->
                    "ナイト検査: 積層データが不完全です。印刷を中止してください。"
                // Header/UI layer estimates do not prove real layers exist.
                // For known-geometry fixtures, always validate the actual
                // LAYER_CHANGE count AND its final Z against model height.
                expectedLayerCount != null && layerCount != expectedLayerCount ->
                    "ナイト検査: 実積層数 $layerCount 層（必要 $expectedLayerCount 層）。印刷を中止してください。"
                expectedLayerCount != null &&
                    kotlin.math.abs(prevZ!! - expected * expectedLayerCount) > tolerance ->
                    "ナイト検査: モデル高さと実積層の最終Zが一致しません。印刷を中止してください。"
                maxZ != null && kotlin.math.abs(prevZ!! - maxZ!!) > tolerance ->
                    "ナイト検査: G-codeの最終高さがモデルと一致しません。印刷を中止してください。"
                else -> null
            }
        } catch (_: Exception) {
            "ナイト検査: 積層検査に失敗しました。印刷を中止してください。"
        }
    }

    fun checkA1MiniPetg(gcodePath: String, expectedNozzleC: Int): String? {
        val file = File(gcodePath)
        if (!file.isFile) return "ナイト検査: G-codeを確認できません。印刷を中止してください。"
        var lastMaterial: String? = null
        var lastTemperature: Double? = null
        var reachedFirstLayer = false
        return try {
            file.bufferedReader().use { reader ->
                for (raw in reader.lineSequence()) {
                    val line = raw.trim()
                    if (line == ";LAYER_CHANGE" || line.startsWith(";LAYER_CHANGE ")) {
                        reachedFirstLayer = true
                        break
                    }
                    if (line.startsWith(";")) continue
                    if (line.startsWith("M1002 set_filament_type:", ignoreCase = true)) {
                        lastMaterial = line.substringAfter(":").trim().substringBefore(" ").uppercase()
                    }
                    heater.find(line)?.let {
                        lastTemperature = it.groupValues[1].toDoubleOrNull()
                    }
                }
            }
            when {
                !reachedFirstLayer ->
                    "ナイト検査: 最初の積層開始位置を確認できません。印刷を中止してください。"
                lastMaterial != "PETG" ->
                    "ナイト検査: PETG設定なのに開始命令が ${lastMaterial ?: "不明"} です。印刷を中止してください。"
                lastTemperature == null ->
                    "ナイト検査: 開始前のノズル温度命令が見つかりません。印刷を中止してください。"
                kotlin.math.abs(lastTemperature!! - expectedNozzleC) > 3.0 ->
                    "ナイト検査: 指定 ${expectedNozzleC}℃ に対し開始命令は ${lastTemperature!!.toInt()}℃。印刷を中止してください。"
                else -> null
            }
        } catch (_: Exception) {
            "ナイト検査: G-code検査に失敗しました。印刷を中止してください。"
        }
    }
}
