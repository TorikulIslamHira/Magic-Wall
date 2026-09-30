using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace MagicWall.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLiveFootballData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_MatchEvent_X",
                table: "MatchEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MatchEvent_Y",
                table: "MatchEvents");

            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "Players",
                type: "TEXT",
                maxLength: 60,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "MediaCheckedAt",
                table: "Players",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PhotoFile",
                table: "Players",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PhotoSourceUrl",
                table: "Players",
                type: "TEXT",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AlterColumn<float>(
                name: "CoordinateY",
                table: "MatchEvents",
                type: "REAL",
                nullable: true,
                oldClrType: typeof(float),
                oldType: "REAL");

            migrationBuilder.AlterColumn<float>(
                name: "CoordinateX",
                table: "MatchEvents",
                type: "REAL",
                nullable: true,
                oldClrType: typeof(float),
                oldType: "REAL");

            migrationBuilder.AddColumn<string>(
                name: "Detail",
                table: "MatchEvents",
                type: "TEXT",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Competition",
                table: "Matches",
                type: "TEXT",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FeedStatus",
                table: "Matches",
                type: "TEXT",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "FeedUpdatedAt",
                table: "Matches",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ScoreA",
                table: "Matches",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ScoreB",
                table: "Matches",
                type: "INTEGER",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TeamMedia",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Team = table.Column<string>(type: "TEXT", maxLength: 100, nullable: false),
                    BadgeSourceUrl = table.Column<string>(type: "TEXT", maxLength: 500, nullable: true),
                    BadgeFile = table.Column<string>(type: "TEXT", maxLength: 100, nullable: true),
                    CheckedAt = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TeamMedia", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Players_ExternalId",
                table: "Players",
                column: "ExternalId",
                unique: true,
                filter: "ExternalId IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MatchEvent_EndNeedsStart",
                table: "MatchEvents",
                sql: "EndCoordinateX IS NULL OR CoordinateX IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MatchEvent_X",
                table: "MatchEvents",
                sql: "CoordinateX IS NULL OR CoordinateX BETWEEN 0 AND 100");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MatchEvent_XY",
                table: "MatchEvents",
                sql: "(CoordinateX IS NULL) = (CoordinateY IS NULL)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MatchEvent_Y",
                table: "MatchEvents",
                sql: "CoordinateY IS NULL OR CoordinateY BETWEEN 0 AND 100");

            migrationBuilder.CreateIndex(
                name: "IX_TeamMedia_Team",
                table: "TeamMedia",
                column: "Team",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TeamMedia");

            migrationBuilder.DropIndex(
                name: "IX_Players_ExternalId",
                table: "Players");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MatchEvent_EndNeedsStart",
                table: "MatchEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MatchEvent_X",
                table: "MatchEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MatchEvent_XY",
                table: "MatchEvents");

            migrationBuilder.DropCheckConstraint(
                name: "CK_MatchEvent_Y",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "MediaCheckedAt",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "PhotoFile",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "PhotoSourceUrl",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "Detail",
                table: "MatchEvents");

            migrationBuilder.DropColumn(
                name: "Competition",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "FeedStatus",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "FeedUpdatedAt",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "ScoreA",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "ScoreB",
                table: "Matches");

            migrationBuilder.AlterColumn<float>(
                name: "CoordinateY",
                table: "MatchEvents",
                type: "REAL",
                nullable: false,
                defaultValue: 0f,
                oldClrType: typeof(float),
                oldType: "REAL",
                oldNullable: true);

            migrationBuilder.AlterColumn<float>(
                name: "CoordinateX",
                table: "MatchEvents",
                type: "REAL",
                nullable: false,
                defaultValue: 0f,
                oldClrType: typeof(float),
                oldType: "REAL",
                oldNullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_MatchEvent_X",
                table: "MatchEvents",
                sql: "CoordinateX BETWEEN 0 AND 100");

            migrationBuilder.AddCheckConstraint(
                name: "CK_MatchEvent_Y",
                table: "MatchEvents",
                sql: "CoordinateY BETWEEN 0 AND 100");
        }
    }
}
