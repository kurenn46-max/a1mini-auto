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
