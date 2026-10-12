package com.u1.slicer.slice

import org.json.JSONObject
import java.io.File
import java.util.Locale
import java.util.zip.ZipFile

/**
 * NIGHT PRINT V4.0.1: never feed A1 mini a sliced .gcode.3mf
 * with filament settings different from its actual G-code.
 * Single-material A1 mini jobs only; no printing here.
 */
internal object NightPrintA1MiniMaterialPacket {
    private val headerMaterial = Regex("^;\\s*filament_type\\s*=\\s*(.+)$", RegexOption.IGNORE_CASE)
    private val execMaterial = Regex("^M1002\\s+set_filament_type:\\s*([^\\s;]+)", RegexOption.IGNORE_CASE)
    private val filamentInXml = Regex("<filament\\b[^>]*\\btype=\"([^\"]+)\"", RegexOption.IGNORE_CASE)

    private fun normalize(value: String): String = value.trim().uppercase(Locale.ROOT)
    private fun fail(reason: String): Nothing =
        throw IllegalStateException("NIGHT PRINT安全検査: $reason。送信・印刷を中止しました。")

    fun verifyGcodeAndResolveSingleMaterial(gcodeFile: File): String {
        if (!gcodeFile.isFile || gcodeFile.length() == 0L) fail("G-codeがありません")
        return try {
            gcodeFile.useLines { verifyGcodeLines(it) }
        } catch (e: IllegalStateException) {
            throw e
        } catch (_: Exception) {
            fail("G-codeの材料情報を読み取れません")
        }
    }

    private fun verifyGcodeLines(lines: Sequence<String>): String {
        val headers = linkedSetOf<String>()
        val commands = linkedSetOf<String>()
        var beforeFirstLayer = true
        var hasFirstLayer = false
        lines.forEach { raw ->
            val line = raw.trim()
            headerMaterial.matchEntire(line)?.groupValues?.get(1)?.let { rawType ->
                val tokens = rawType.split(';', ',', '/').map(::normalize).filter { it.isNotEmpty() }
                if (tokens.size != 1) fail("複数材料または不正な材料宣言です")
                headers += tokens.single()
            }
            if (line.startsWith(";LAYER_CHANGE")) {
                beforeFirstLayer = false
                hasFirstLayer = true
            }
            if (beforeFirstLayer) {
                execMaterial.find(line)?.let { commands += normalize(it.groupValues[1]) }
            }
        }
        if (!hasFirstLayer) fail("積層開始命令がありません")
        if (headers.size != 1 || commands.size != 1) {
            fail("材料情報が欠落・矛盾しています (header=$headers, command=$commands)")
        }
        val declared = headers.single()
        val executable = commands.single()
        if (declared != executable) {
            fail("G-code内で材料が一致しません ($declared / $executable)")
        }
        if (!Regex("^[A-Z][A-Z0-9 _+-]{0,24}$").matches(declared)) {
            fail("不正な材料名です")
        }
        return declared
    }

    fun verifyPackagedProject(projectFile: File, material: String, plateId: Int) {
        if (!projectFile.isFile || projectFile.length() == 0L) fail("送信用3MFがありません")
        try {
            ZipFile(projectFile).use { zip ->
                fun body(name: String): String {
                    val entry = zip.getEntry(name) ?: fail("送信用3MFに$name がありません")
                    return zip.getInputStream(entry).bufferedReader().use { it.readText() }
                }
                val project = JSONObject(body("Metadata/project_settings.config"))
                val types = project.optJSONArray("filament_type")
                    ?: fail("送信用3MFの材料設定がありません")
                if (types.length() != 1 || normalize(types.optString(0)) != material) {
                    fail("送信用3MFの材料設定がG-codeと不一致 (expected=$material)")
                }
                val xml = body("Metadata/slice_info.config")
                val xmlTypes = filamentInXml.findAll(xml).map { normalize(it.groupValues[1]) }.toList()
                if (xmlTypes != listOf(material)) {
                    fail("送信用3MFのプレート材料情報が不一致 (expected=$material actual=$xmlTypes)")
                }
                val gcodeEntryName = "Metadata/plate_${plateId}.gcode"
                val entry = zip.getEntry(gcodeEntryName) ?: fail("送信用3MF内にG-codeがありません")
                val plateMaterial = zip.getInputStream(entry).bufferedReader().useLines { verifyGcodeLines(it) }
                if (plateMaterial != material) {
                    fail("送信用3MF内の実G-codeが不一致 ($plateMaterial / $material)")
                }
            }
        } catch (e: IllegalStateException) {
            throw e
        } catch (_: Exception) {
            fail("送信用3MFの材料照合に失敗しました")
        }
    }
}
